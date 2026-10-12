import { test, expect } from "@playwright/test";
import sharp from "sharp";

test("upload, edit all platform fields, export actual CSV, and run local AI upscale", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "이미지 라이브러리" }),
  ).toBeVisible();
  const buffer = await sharp(
    Buffer.from(
      '<svg width="80" height="80" xmlns="http://www.w3.org/2000/svg"><rect x="15" y="15" width="50" height="50" rx="12" fill="#c7e890"/><circle cx="40" cy="40" r="12" fill="#435433"/></svg>',
    ),
  )
    .png()
    .toBuffer();
  await page
    .getByLabel("이미지 파일 업로드")
    .setInputFiles({ name: "green-icon.png", mimeType: "image/png", buffer });
  await expect(
    page.getByRole("heading", { name: "green-icon.png" }),
  ).toBeVisible();
  await page
    .getByRole("article")
    .getByRole("button", { name: "생성 대기", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("제목", { exact: false })
    .fill("Green app icon on transparent background");
  await dialog
    .getByLabel("키워드", { exact: false })
    .fill("green, icon, app, interface, button");
  await dialog.getByRole("button", { name: "Freepik", exact: false }).click();
  await dialog
    .getByLabel("제목", { exact: false })
    .fill("Green application icon");
  await dialog
    .getByLabel("키워드", { exact: false })
    .fill("green, icon, app, interface, button, _ai_generated");
  await dialog
    .getByRole("button", { name: "미리캔버스", exact: false })
    .click();
  await dialog
    .getByLabel("요소 이름", { exact: false })
    .fill("초록색 앱 아이콘");
  await dialog
    .getByLabel("키워드", { exact: false })
    .fill("초록, 아이콘, 앱, 버튼, 인터페이스");
  await dialog.getByRole("button", { name: "변경 저장" }).click();
  await expect(page.getByRole("status")).toContainText("메타데이터를 저장");
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByRole("button", { name: "내보내기", exact: true }).click();
  await page
    .getByLabel("이미지와 메타데이터를 ZIP 패키지로 내보내기")
    .uncheck();
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "내보내기", exact: true })
    .click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("adobe-metadata.csv");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "닫기", exact: true })
    .click();
  await page
    .getByRole("button", { name: "AI 업스케일링", exact: true })
    .click();
  await page.getByRole("button", { name: "2× AI 업스케일" }).click();
  await expect(page.getByText("↗ FSRCNN 2× 복원 완료")).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("button", { name: "이미지 비교", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("현재 160 × 160");
  await page.getByLabel("원본 결과 비교 위치").fill("70");
  expect(errors).toEqual([]);
});

test("settings show key status without exposing saved values, layout fits mobile", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "설정 및 API 연결" }).click();
  await page
    .locator("label.field")
    .filter({ hasText: "Gemini API 키" })
    .locator("input")
    .fill("browser-test-placeholder");
  await page.getByRole("button", { name: "설정 저장", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("설정을 저장");
  await page.reload();
  await page.getByRole("button", { name: "설정 및 API 연결" }).click();
  await expect(
    page
      .locator("label.field")
      .filter({ hasText: "Gemini API 키" })
      .locator("input"),
  ).toHaveValue("");
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "이미지 라이브러리", exact: false })
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});

test('Gemini connection check sends the entered key and displays the recommended model', async ({page}) => {
  await page.route('**/api/gemini/models', async route => {
    expect(route.request().postDataJSON()).toEqual({key:'unsaved-test-key'});
    await route.fulfill({json:{models:[{id:'gemini-3-flash',displayName:'Flash'}],recommended:'gemini-3-flash'}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'설정 및 API 연결'}).click();
  await page.locator('label.field').filter({hasText:'Gemini API 키'}).locator('input').fill('unsaved-test-key');
  await page.getByRole('button',{name:'API 연결 확인 · 모델 조회'}).click();
  await expect(page.getByRole('status')).toContainText('gemini-3-flash');
  await expect(page.locator('input[list="gemini-model-list"]')).toHaveValue('auto');
});
