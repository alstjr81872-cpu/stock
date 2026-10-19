"use client";
import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Bold, Italic, Undo2, Redo2 } from "lucide-react";
import { Button } from "./ui/button";
export default function Editor({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: "당신의 이야기를 써 내려가세요…" }),
    ],
    immediatelyRender: false,
    content: toDoc(value),
    editable: !disabled,
    onUpdate: ({ editor }) =>
      onChange(editor.getText({ blockSeparator: "\n\n" })),
    editorProps: {
      attributes: {
        "aria-label": "원고 편집기",
        role: "textbox",
        "aria-multiline": "true",
      },
    },
  });
  useEffect(() => {
    if (editor && editor.getText({ blockSeparator: "\n\n" }) !== value)
      editor.commands.setContent(toDoc(value), { emitUpdate: false });
  }, [value, editor]);
  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);
  return (
    <div className="editor-shell">
      <div className="editor-toolbar">
        <span>본문</span>
        <Button
          variant="ghost"
          size="sm"
          aria-label="굵게"
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <Bold size={16} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label="기울임"
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <Italic size={16} />
        </Button>
        <span className="toolbar-separator" />
        <Button
          variant="ghost"
          size="sm"
          aria-label="실행 취소"
          onClick={() => editor?.chain().focus().undo().run()}
        >
          <Undo2 size={16} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label="다시 실행"
          onClick={() => editor?.chain().focus().redo().run()}
        >
          <Redo2 size={16} />
        </Button>
        <small>서식은 편집용 · 서버에는 본문 텍스트 저장</small>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
function toDoc(s: string) {
  return {
    type: "doc",
    content: s
      .split("\n\n")
      .map((t) => ({
        type: "paragraph",
        ...(t ? { content: [{ type: "text", text: t }] } : {}),
      })),
  };
}
