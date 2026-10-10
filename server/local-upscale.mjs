import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
export const localPython = path.resolve(".venv/bin/python");
export const modelDir = path.resolve(".data/models");
export function localReady() {
  return (
    fs.existsSync(localPython) &&
    [2, 4].every((s) => fs.existsSync(path.join(modelDir, `FSRCNN_x${s}.pb`)))
  );
}
export async function localUpscale(input, output, scale) {
  if (!localReady())
    throw new Error(
      "로컬 모델 준비가 필요합니다. README의 로컬 업스케일러 설치 명령을 실행해주세요.",
    );
  try {
    await execute(
      localPython,
      [
        path.resolve("scripts/upscale.py"),
        "--input",
        input,
        "--output",
        output,
        "--scale",
        String(scale),
        "--models",
        modelDir,
      ],
      { timeout: 600_000, maxBuffer: 16_000 },
    );
  } catch {
    if (fs.existsSync(output)) fs.rmSync(output);
    throw new Error(
      "로컬 AI 복원에 실패했습니다. 이미지 크기와 Python/OpenCV 설치를 확인해주세요.",
    );
  }
}
