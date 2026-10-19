import * as validators from "./validators";
import { HttpError } from "./shared";
export function validate(name: string, value: unknown): any {
  const fn = (validators as Record<string, any>)[name];
  if (!fn || !fn(value))
    throw new HttpError(
      422,
      "입력 또는 AI 응답의 형식을 확인해주세요. (" + name + ")",
    );
  return value;
}
