from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
import httpx

from app.core.config import settings
from app.core.security import get_current_user
from app.models.models import User

router = APIRouter(prefix="/api/feedback", tags=["feedback"])

LINEAR_API_URL = "https://api.linear.app/graphql"

PRIORITY_MAP = {
    "urgent": 1,
    "high": 2,
    "medium": 3,
    "low": 4,
}


class FeedbackCreate(BaseModel):
    title: str
    description: Optional[str] = None
    type: str = "Bug"
    priority: str = "medium"


class FeedbackResponse(BaseModel):
    url: Optional[str] = None
    identifier: Optional[str] = None


@router.post("/", response_model=FeedbackResponse)
async def submit_feedback(
    payload: FeedbackCreate,
    current_user: User = Depends(get_current_user),
):
    if not settings.LINEAR_API_TOKEN or not settings.LINEAR_TEAM_ID:
        raise HTTPException(status_code=503, detail="Feedback service not configured")

    priority_int = PRIORITY_MAP.get(payload.priority.lower(), 3)

    description_md = payload.description or ""
    if description_md:
        description_md = f"{description_md}\n\n---\n*Submitted by: {current_user.email} | Type: {payload.type}*"
    else:
        description_md = f"*Submitted by: {current_user.email} | Type: {payload.type}*"

    mutation = """
    mutation CreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue {
          id
          identifier
          url
        }
      }
    }
    """

    variables = {
        "input": {
            "teamId": settings.LINEAR_TEAM_ID,
            "title": f"[{payload.type}] {payload.title}",
            "description": description_md,
            "priority": priority_int,
        }
    }

    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(
            LINEAR_API_URL,
            json={"query": mutation, "variables": variables},
            headers={"Authorization": settings.LINEAR_API_TOKEN, "Content-Type": "application/json"},
        )

    if response.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to reach Linear API")

    data = response.json()
    errors = data.get("errors")
    if errors:
        raise HTTPException(status_code=502, detail=errors[0].get("message", "Linear API error"))

    issue = data.get("data", {}).get("issueCreate", {}).get("issue", {})
    return FeedbackResponse(url=issue.get("url"), identifier=issue.get("identifier"))
