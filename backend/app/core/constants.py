"""Cross-cutting domain constants shared across routes and services.

Month arrays come in two indexing conventions that must never be mixed:
the *_1 lists have a deliberate blank at index 0 so MONTH_NAMES_1[3] ==
"March" for a 1-based month number; the *_0 lists are plain 0-indexed.
Import the shape your call sites already use.
"""

MONTH_NAMES_1 = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]

MONTHS_SHORT_1 = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

MONTH_NAMES_0 = MONTH_NAMES_1[1:]

MONTHS_SHORT_0 = MONTHS_SHORT_1[1:]
