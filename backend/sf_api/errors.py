"""Every error leaves the API as JSON: {"error": {"code", "message", "details"}}.

Route code raises ApiError for anything it expects (bad input, not found,
conflicts). Flask's own errors (404 for an unknown path, 405) and crashes are
converted here too, so the admin pages never have to parse an HTML error page.
"""

import logging
from typing import TypeVar

from flask import Flask, jsonify, request
from pydantic import BaseModel, ValidationError
from werkzeug.exceptions import HTTPException

from sf_shared.validate import format_validation_error

log = logging.getLogger(__name__)

Model = TypeVar("Model", bound=BaseModel)


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, details: object = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details


def error_response(status: int, code: str, message: str, details: object = None):
    body = {"error": {"code": code, "message": message, "details": details}}
    return jsonify(body), status


def validation_problems(error: ValidationError, label: str = "") -> list[str]:
    """One readable line per problem, like 'final.kind: must be one of argument, milestone_evidence'."""
    return format_validation_error(label, error)


def parse_body(model: type[Model]) -> Model:
    """Read the JSON body and validate it with a Pydantic model, or raise a 400."""
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError(400, "invalid_json", "The request body must be a JSON object.")
    try:
        return model.model_validate(data)
    except ValidationError as error:
        raise ApiError(400, "invalid_body", "Some fields aren't valid.", validation_problems(error)) from None


def query_int(name: str, default: int, minimum: int, maximum: int) -> int:
    """An integer from the query string (?limit=20), checked against its range."""
    text = request.args.get(name, "").strip()
    if text == "":
        return default
    try:
        value = int(text)
    except ValueError:
        raise ApiError(400, "invalid_query", f"{name} must be a whole number.") from None
    if value < minimum or value > maximum:
        raise ApiError(400, "invalid_query", f"{name} must be between {minimum} and {maximum}.")
    return value


# Flask's status codes, turned into short stable codes the admin pages can switch on.
HTTP_CODES = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    413: "body_too_large",
    415: "unsupported_media_type",
    429: "too_many_requests",
}


def register_error_handlers(app: Flask) -> None:
    @app.errorhandler(ApiError)
    def handle_api_error(error: ApiError):
        return error_response(error.status, error.code, error.message, error.details)

    @app.errorhandler(HTTPException)
    def handle_http_error(error: HTTPException):
        status = error.code or 500
        code = HTTP_CODES.get(status, "http_error")
        return error_response(status, code, error.description or error.name)

    @app.errorhandler(Exception)
    def handle_crash(error: Exception):
        # The traceback goes to the server log; the client only gets a short message,
        # because exception text can include connection strings or document contents.
        log.exception("Unhandled error on %s %s", request.method, request.path)
        return error_response(500, "internal_error", "Something went wrong on the server. The error is in its log.")
