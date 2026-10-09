import { expect, test } from "vitest";
import { ApiError, detalheErro } from "../src/lib/api";
test("explains contract validation fields without including submitted values", () => {
  const error = new ApiError(422, {detail:[{loc:["body","parcelas"],msg:"Input should be greater than or equal to 1",input:"private"}]});
  expect(detalheErro(error)).toContain("parcelas:");
  expect(detalheErro(error)).not.toContain("private");
});
test("preserves business errors",()=>expect(detalheErro(new ApiError(409,{detail:"Lead já contratado"}))).toBe("Lead já contratado"));
test("identifies expired session",()=>expect(detalheErro(new ApiError(401,null))).toContain("sessão expirou"));
test("handles non-JSON server failure",()=>expect(detalheErro(new ApiError(500,null))).toContain("Atualize a lista"));
