"""Generate portable schemas/prompts from the preserved Python implementation."""
import json
from pathlib import Path
from backend import schemas, mock_ai
root=Path(__file__).resolve().parents[1]
names=['Revision','Confirm','AIRequest','Answers','SectionEdit','StyleCreate','StyleApprove','StyleEdit','BindStyle','ChapterSave','ChapterApprove','Restore','SettingsEdit','PartialEdit','ApplyRewrite','PlotEdit','StyleNotes','AnalysisEdit','StyleAnalysisEdit','ResolveFinding','Analysis','BibleSection','StyleAnalysis','Plot','Review','Rewrite','BibleAudit','AutoPlanRequest','PlanningProposal','ApplyPlanning','TreePatch','TreeRequest','RenameEntity']
names.append('EntityNameSuggestion')
names.append('PlotDevelopment')
names.extend(['PlotGaps', 'PlotDevelopRequest'])
names.extend(['SynopsisBatch', 'SelectEpisode', 'WritingSettings'])
names.extend(['LaunchPlan', 'ApplyLaunch'])
names.extend(['ChatStart', 'ChatRequest', 'ChatResponse', 'CanonEdit', 'ChatApply'])
assets={'schemas':{name:getattr(schemas,name).model_json_schema() for name in names},'prompts':{p.stem:p.read_text() for p in (root/'prompts').glob('*.txt')},'modules':mock_ai.MODULES,'scenario':mock_ai.SCENARIO}
# Pydantic's default_factory=list is optional in JSON Schema but omits default.
# Materialize that default so the portable validator matches Python behavior.
def array_defaults(schema):
    if isinstance(schema, dict):
        required = schema.get('required', [])
        for key, prop in schema.get('properties', {}).items():
            if key not in required and prop.get('type') == 'array' and 'default' not in prop:
                prop['default'] = []
        for value in schema.values():
            array_defaults(value)
    elif isinstance(schema, list):
        for value in schema:
            array_defaults(value)
for schema in assets['schemas'].values():
    array_defaults(schema)
(root/'worker/assets.json').write_text(json.dumps(assets,ensure_ascii=False,indent=2)+'\n')
