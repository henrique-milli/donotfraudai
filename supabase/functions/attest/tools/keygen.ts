/** Generates an envelope key pair. Prints the secrets to set (never commit them). */
import { generateKey } from "../../_shared/envelope.ts";

const kid = Deno.args[0] ?? `k${new Date().toISOString().slice(0, 10).replaceAll("-", "")}`;
const pkcs8 = await generateKey();
console.log(`ATTEST_KEYS={"${kid}":"${pkcs8}"}`);
console.log(`ATTEST_ACTIVE_KID=${kid}`);
