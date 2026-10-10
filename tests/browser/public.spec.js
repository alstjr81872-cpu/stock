import { test, expect } from "@playwright/test";
import sharp from "sharp";
test.use({ baseURL: "http://127.0.0.1:3102" });
test("public site gives two browsers independent private workspaces", async ({
  browser,
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByText("로그인 없이 이용하는 임시 개인 작업 공간입니다.", {
      exact: false,
    }),
  ).toBeVisible();
  const image = await sharp({
    create: { width: 60, height: 60, channels: 3, background: "#87ac59" },
  })
    .png()
    .toBuffer();
  await page
    .getByLabel("이미지 파일 업로드")
    .setInputFiles({
      name: "private-image.png",
      mimeType: "image/png",
      buffer: image,
    });
  await expect(
    page.getByRole("heading", { name: "private-image.png" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "private-image.png" }),
  ).toBeVisible();
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto("http://127.0.0.1:3102");
  await expect(
    otherPage.getByText("첫 번째 이미지를 기다리고 있어요"),
  ).toBeVisible();
  await expect(
    otherPage.getByRole("heading", { name: "private-image.png" }),
  ).toHaveCount(0);
  const cookies = await page.context().cookies();
  const session = cookies.find((c) => c.name === "__Host-stock_workspace");
  expect(session.httpOnly).toBe(true);
  expect(session.secure).toBe(true);
  await other.close();
  expect(errors).toEqual([]);
});
