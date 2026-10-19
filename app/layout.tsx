import type { Metadata } from "next";
import "./globals.css";
import "./ui-refresh.css";
export const metadata: Metadata = {
  title: "NovelForge AI · 이야기가 작품이 되는 곳",
  description:
    "아이디어부터 마지막 문장까지. 작가의 선택을 존중하는 한국어 장편 창작 워크스페이스.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
