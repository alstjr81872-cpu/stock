"""Generate portable schemas/prompts from the preserved Python implementation."""
import json
from pathlib import Path
from backend import schemas, mock_ai
root=Path(__file__).resolve().parents[1]
names=['Revision','Confirm','AIRequest','Answers','SectionEdit','StyleCreate','StyleApprove','StyleEdit','BindStyle','ChapterSave','ChapterApprove','Restore','SettingsEdit','PartialEdit','ApplyRewrite','PlotEdit','StyleNotes','AnalysisEdit','StyleAnalysisEdit','ResolveFinding','Analysis','BibleSection','StyleAnalysis','Plot','Review','Rewrite','BibleAudit']
assets={'schemas':{name:getattr(schemas,name).model_json_schema() for name in names},'prompts':{p.stem:p.read_text() for p in (root/'prompts').glob('*.txt')},'modules':mock_ai.MODULES,'scenario':mock_ai.SCENARIO}
(root/'worker/assets.json').write_text(json.dumps(assets,ensure_ascii=False,indent=2)+'\n')
