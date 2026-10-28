"""Translate the team's search text into each database's own syntax.

The searches in search_config are written once, in the style most people
know from library catalogs:

    "brain-computer interface" AND (alignment OR "AI safety")

Words, "quoted phrases", AND, OR, NOT and parentheses. Two words next to each
other mean AND. Operators can be upper or lower case.

arXiv and Semantic Scholar spell this differently, so each collector
translates it:

    arXiv             all:"brain-computer interface" AND (all:alignment OR all:"AI safety")
    Semantic Scholar  "brain-computer interface" + (alignment | "AI safety")
"""

import re
from dataclasses import dataclass
from typing import Literal

TokenKind = Literal["term", "phrase", "and", "or", "not", "open", "close"]

TOKEN_PATTERN = re.compile(r'"([^"]*)"|(\()|(\))|([^\s()"]+)|"')
OPERATORS: dict[str, TokenKind] = {"and": "and", "or": "or", "not": "not"}


class QuerySyntaxError(ValueError):
    """The search text can't be translated. The message says what to fix."""


@dataclass(frozen=True)
class Token:
    kind: TokenKind
    text: str = ""

    @property
    def is_operand(self) -> bool:
        return self.kind in ("term", "phrase")


def tokenize(text: str) -> list[Token]:
    tokens: list[Token] = []
    for match in TOKEN_PATTERN.finditer(text):
        phrase, open_paren, close_paren, word = match.groups()
        if phrase is not None:
            phrase = " ".join(phrase.split())
            if phrase:
                tokens.append(Token("phrase", phrase))
        elif open_paren:
            tokens.append(Token("open"))
        elif close_paren:
            tokens.append(Token("close"))
        elif word:
            operator = OPERATORS.get(word.lower())
            tokens.append(Token(operator) if operator else Token("term", word))
        # A lone, unmatched double quote is skipped.
    return tokens


def normalize_tokens(text: str) -> list[Token]:
    """Tokens with every AND written out and "AND NOT" folded into NOT.

    Afterwards NOT always means "and not": it sits between two operands.
    Raises QuerySyntaxError for anything ambiguous.
    """
    raw = tokenize(text)
    if not raw:
        raise QuerySyntaxError("The search is empty.")

    tokens: list[Token] = []
    for token in raw:
        previous = tokens[-1] if tokens else None
        ends_operand = previous is not None and (previous.is_operand or previous.kind == "close")
        starts_operand = token.is_operand or token.kind == "open"

        if starts_operand and ends_operand:
            tokens.append(Token("and"))
        elif token.kind == "not" and previous is not None and previous.kind == "and":
            tokens.pop()  # "AND NOT" is the same as NOT
        elif token.kind == "not" and not ends_operand:
            raise QuerySyntaxError(
                'NOT has to come after a term, like brain NOT mouse. arXiv can\'t search for "everything except".'
            )
        elif token.kind in ("and", "or") and not ends_operand:
            raise QuerySyntaxError(f"{token.kind.upper()} needs a term on both sides.")
        elif token.kind == "close" and not ends_operand:
            raise QuerySyntaxError("A pair of parentheses is empty, or an operator comes right before a closing one.")
        tokens.append(token)

    if tokens[-1].kind in ("and", "or", "not"):
        raise QuerySyntaxError(f"The search ends with {tokens[-1].kind.upper()}.")

    depth = 0
    for token in tokens:
        if token.kind == "open":
            depth += 1
        elif token.kind == "close":
            depth -= 1
            if depth < 0:
                raise QuerySyntaxError("A closing parenthesis has no opening one.")
    if depth != 0:
        raise QuerySyntaxError("A parenthesis is never closed.")
    return tokens


def quoted_if_needed(token: Token) -> str:
    """Phrases keep their quotes. Hyphenated words get quotes too, because a
    leading or inner hyphen can read as NOT in both search engines."""
    if token.kind == "phrase" or "-" in token.text:
        return f'"{token.text}"'
    return token.text


def to_arxiv_query(text: str) -> str:
    """arXiv search_query syntax, searching all fields."""
    parts: list[str] = []
    for token in normalize_tokens(text):
        if token.is_operand:
            parts.append("all:" + quoted_if_needed(token))
        elif token.kind == "and":
            parts.append("AND")
        elif token.kind == "or":
            parts.append("OR")
        elif token.kind == "not":
            parts.append("ANDNOT")
        elif token.kind == "open":
            parts.append("(")
        else:
            parts.append(")")
    return join_with_parentheses(parts)


def to_semantic_scholar_query(text: str) -> str:
    """Semantic Scholar bulk search syntax: + for AND, | for OR, a leading - for NOT."""
    parts: list[str] = []
    negate_next = False
    for token in normalize_tokens(text):
        prefix = "-" if negate_next else ""
        if token.is_operand:
            parts.append(prefix + quoted_if_needed(token))
            negate_next = False
        elif token.kind == "open":
            parts.append(prefix + "(")
            negate_next = False
        elif token.kind == "close":
            parts.append(")")
        elif token.kind == "and":
            parts.append("+")
        elif token.kind == "or":
            parts.append("|")
        else:
            # "a NOT b" becomes "a -b": terms side by side already mean AND.
            negate_next = True
    return join_with_parentheses(parts)


def join_with_parentheses(parts: list[str]) -> str:
    """Join with spaces, but keep parentheses tight: (a OR b), not ( a OR b )."""
    text = ""
    for part in parts:
        if not text or text.endswith("(") or part == ")":
            text += part
        else:
            text += " " + part
    return text
