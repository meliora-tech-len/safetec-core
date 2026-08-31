"""Helpers for turning a partial-update payload into a change set."""


def sent_fields(payload, *clearable, exclude=None):
    """Build the change set for a PUT: only the fields the client actually sent.

    ``exclude_none=True`` stops an omitted field from wiping the stored value,
    but it also swallows an explicit null — which is how the UI says "take this
    away", so a note could be edited and never removed. Fields named in
    ``clearable`` are put back whenever the client really sent them, with blank
    text stored as NULL.
    """
    updates = payload.model_dump(exclude_none=True, exclude=exclude)
    for field in clearable:
        if field in payload.model_fields_set:
            value = getattr(payload, field, None)
            updates[field] = value.strip() or None if isinstance(value, str) else value
    return updates
