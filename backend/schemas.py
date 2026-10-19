from enum import StrEnum
from typing import Literal
from pydantic import BaseModel, Field, ConfigDict


class ProjectStatus(StrEnum):
    IDEA = "IDEA"
    DRAFT_BIBLE = "DRAFT_BIBLE"
    BIBLE_REVIEW = "BIBLE_REVIEW"
    ACTIVE = "ACTIVE"
    ARCHIVED = "ARCHIVED"


class PlotStatus(StrEnum):
    DRAFT = "DRAFT"
    REVIEW = "REVIEW"
    APPROVED = "APPROVED"
    INVALIDATED = "INVALIDATED"


class ChapterStatus(StrEnum):
    PLANNED = "PLANNED"
    DRAFTING = "DRAFTING"
    REVIEW = "REVIEW"
    REQUIRES_HUMAN = "REQUIRES_HUMAN"
    APPROVED = "APPROVED"
    LOCKED = "LOCKED"


class JobStatus(StrEnum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    PAUSING = "PAUSING"
    PAUSED = "PAUSED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Revision(Strict):
    revision: int = Field(ge=1)


class Confirm(Revision):
    confirmed: bool


class AIRequest(Revision):
    consent: bool = False
    maxCostUsd: float = Field(default=0.15, gt=0, le=5)


class Question(Strict):
    id: str
    question: str
    importance: Literal["high", "medium", "low"] = "high"
    rationale: str
    options: list[str] = Field(default_factory=list)
    blocks_stage: bool = True


class Analysis(Strict):
    summary: str
    loglines: list[str] = Field(min_length=2, max_length=3)
    questions: list[Question] = Field(min_length=5, max_length=8)
    conflicts: list[str] = Field(default_factory=list)


class BibleSection(Strict):
    content: str = Field(min_length=60, max_length=20000)
    rules_and_causes: str = Field(min_length=10)
    scene_example: str = Field(min_length=10)
    reader_payoff: str = Field(min_length=10)
    connections: str = Field(min_length=10)
    risks: str = Field(min_length=5)
    requirementIds: list[str]
    openQuestions: list[str] = Field(default_factory=list)
    conflicts: list[str] = Field(default_factory=list)


class Variant(Strict):
    id: Literal["A", "B", "C"]
    title: str
    rules: dict[str, str]
    positive: str = Field(min_length=40)
    negative: str = Field(min_length=20)
    why: str


class StyleAnalysis(Strict):
    summary: str
    variants: list[Variant] = Field(min_length=3, max_length=3)
    evidence: list[str]
    questions: list[str]
    conflicts: list[str]


class Scene(Strict):
    id: str
    title: str
    pov: str
    characters: list[str]
    startState: str
    goal: str
    action: str
    endState: str
    causalEvidence: str
    readerPayoff: str
    hiddenInformation: list[str]
    targetChars: int = Field(ge=200, le=5000)


class Plot(Strict):
    direction: str
    arcs: list[dict[str, str]]
    chapterTitle: str
    scenes: list[Scene] = Field(min_length=2, max_length=6)
    risks: list[str]
    openQuestions: list[str]


class Finding(Strict):
    id: str
    severity: Literal["info", "warning", "critical"]
    quote: str
    rationale: str
    evidence: str
    fixHint: str
    confidence: float = Field(ge=0, le=1)
    requiresHuman: bool


class Review(Strict):
    findings: list[Finding]
    strengths: list[str]
    summary: str
    requiresHuman: bool


class Rewrite(Strict):
    replacement: str = Field(min_length=1)
    reason: str
    risks: list[str]


class Answers(Revision):
    answers: dict[str, str]


class SectionEdit(Revision):
    section: BibleSection


class StyleCreate(Strict):
    name: str = Field(min_length=1, max_length=100)
    sourceType: Literal["interview", "guide", "reference"] = "interview"
    notes: str = Field(default="", max_length=30000)


class StyleApprove(Confirm):
    variant: Literal["A", "B", "C"]


class StyleEdit(Revision):
    name: str = Field(min_length=1, max_length=100)
    rules: dict[str, str]


class BindStyle(Revision):
    styleId: str


class ChapterSave(Revision):
    content: str = Field(max_length=1_000_000)
    title: str = Field(max_length=150)


class ChapterApprove(Confirm):
    reviewed: bool


class Restore(Revision):
    versionId: str


class SettingsEdit(Strict):
    models: dict[str, str]
    monthlyBudgetUsd: float = Field(ge=0, le=500)
    maxOutputTokens: int = Field(default=3000, ge=512, le=10000)


class PartialEdit(AIRequest):
    start: int = Field(ge=0)
    end: int = Field(ge=1)
    instruction: str = Field(min_length=3, max_length=2000)


class ApplyRewrite(Revision):
    proposalId: str


class PlotEdit(Revision):
    plot: Plot


class StyleNotes(Revision):
    notes: str = Field(min_length=1, max_length=30000)


class AnalysisEdit(Revision):
    analysis: Analysis


class StyleAnalysisEdit(Revision):
    analysis: StyleAnalysis


class BibleFinding(Strict):
    id: str
    section: str
    severity: Literal["info", "warning", "critical"]
    evidence: str
    rationale: str
    decisionNeeded: bool


class BibleAudit(Strict):
    summary: str
    findings: list[BibleFinding]
    unresolvedDecisions: list[str]


class ResolveFinding(Confirm):
    findingId: str
    resolution: str = Field(min_length=10, max_length=2000)
