/**
 * Certificate signature checks on the chain shape Android key attestation produces: an RSA root, a
 * P-384 intermediate that signs its P-256 child with ecdsa-with-SHA256 (a curve/hash pair Deno's
 * WebCrypto ECDSA refuses). Synthetic certificates generated with openssl, no device data.
 */
import { assert, assertFalse } from "jsr:@std/assert@1";
import * as x509 from "npm:@peculiar/x509@1.12.3";
import { verifyCert } from "../../_shared/attestation.ts";
import { unb64 } from "../../_shared/util.ts";

const LEAF = "MIIBRDCBzAIJAP9xRlLXoRkKMAoGCCqGSM49BAMCMCIxIDAeBgNVBAMMF1Rlc3QgUC0zODQgSW50ZXJtZWRpYXRlMB4XDTI2MDkyNDE1NDcyM1oXDTM2MDkyMTE1NDcyM1owFDESMBAGA1UEAwwJVGVzdCBMZWFmMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEL7faMCNppjw0SPF+qWC0ymCwWIVjtEflfbkzftWNKTRJPkK1J/PqLHCK9qqhZc6mxXiltVyYBsrxc0y5PunJmjAKBggqhkjOPQQDAgNnADBkAjBmIaltRXRywnIZm4N7r+v81TG4AgIDubwRuUZdjbRf8bpyEVprl4x+0kqfBnl8Wx4CMAGgXyP+cTmSDcLArREaRHaI4cKzXEoSweNmUMGqWmBrS/RFW3Debj8B9FGMZ8YWXw==";
const INT = "MIICHjCCAQagAwIBAgIJAMdr4NsJP2oGMA0GCSqGSIb3DQEBCwUAMBQxEjAQBgNVBAMMCVRlc3QgUm9vdDAeFw0yNjA5MjQxNTQ3MjNaFw0zNjA5MjExNTQ3MjNaMCIxIDAeBgNVBAMMF1Rlc3QgUC0zODQgSW50ZXJtZWRpYXRlMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAEhmgty+gBuJTYSdvXXO6vIR7pS9KBXYMZlSKx8bEDrIgG0+h6W+3LnqnD6/WqCxrqI+tRDsQDNARQKIEd76iIsW19N3S0qAJKdPbuuNGlCnOz9p6NWcVIFXSNVGe94LbyoxMwETAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQDCPHW7KYutpsniJWbZdGh1aRo3xl3sPCanUqfZliftJcwTPfReBc+Oxr+cjF2oNWWQG0/mLVaAF3wWqAtQR63S4X2HynhbohtiK/fltJoqpL+EEEXLbZ6cVGN4BS3z/Kejq8imRIEpoO/ouaUW/Gs5/vpxXPW0523Nf8IX5eb8MsLgDd7Hw668VQ5DslFqkJAupbDkwImEFbHND+WPKDLKsJNo7CS3xmpJVNd2Ss/7LeVAZEM/O4nNisJHWi7O9Ot4eXSLZAV8NhwaOLWQM9MPdFlkrLoTiuMFvmEPuyL+kbdIPmooAJhXrI5eV5UM0+hLgVv4ZDkKzYgyDpcw/p1Z";
const ROOT = "MIICpDCCAYwCCQDw76JIPCIuQDANBgkqhkiG9w0BAQsFADAUMRIwEAYDVQQDDAlUZXN0IFJvb3QwHhcNMjYwOTI0MTU0NzIzWhcNMzYwOTIxMTU0NzIzWjAUMRIwEAYDVQQDDAlUZXN0IFJvb3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDl6Sckh4sCQUfur2EAZ74/1mYY707g0P1ylw6+A45FwX5FZ+ugqp4rmBqCpczPXsAl192vVsObMUYLfv/vRCHi00GvgWo81f5c9Y5FbLvklu/035lOOWB3XEdUfHu69DFpV7juZDuajwHATORPpu/9YoZWxAgc4QNZqeZNde3+Gb8e5qVxszdV//q5d/AzT0eoNIt2ZCy3B+v1lIE8roQgnx1biLiRxtSSXNS1jcrxIJ5Sx2gTgSI0sQJTahXuacLNQgu/pbFBBjU3yVuE46f78YGnG5OqXkWkikUyeu7Jw2dtYN75tqlreykdOSrz8QjLo6Rwt6W4nucauZ+jzA79AgMBAAEwDQYJKoZIhvcNAQELBQADggEBAKO+u0Zexlsgy0MGEGwivGDws8ierscmXa2oFXnDj60bUx+qeQuTSBavWFSzmhrBxVFKf59LSyWwdWsB2KOepiNdu8BQRIWScc81zmKKB8UWd4IR0Q73hxJ4XXwQTucWjvuWuJ0n5lkdt3TMAuhcgC0RyMt1EbziNHfow2fm7wimYlN2R2dtss8LdEOkdXWtugJeulMe0TO5RfbK/ilepH6acXAOKRkDmGcp1wizl0y0jBfasOND4Hab9RQEeQ9X6X749xjzER4w2hJVVzlRztug9OQmBefhmDQH542YP5Mb93ntRhPtf0UYh9J99hJicRTdOxZCNfCfU1rtF3nO/go=";
const cert = (b: string) => new x509.X509Certificate(unb64(b));

Deno.test("mixed-curve chain verifies link by link", async () => {
  assert(await verifyCert(cert(LEAF), cert(INT)), "P-256 leaf signed by P-384 key with SHA-256");
  assert(await verifyCert(cert(INT), cert(ROOT)), "P-384 intermediate signed by RSA root");
  assert(await verifyCert(cert(ROOT), cert(ROOT)), "self-signed root");
});

Deno.test("wrong issuer or a flipped bit fails", async () => {
  assertFalse(await verifyCert(cert(LEAF), cert(ROOT)));
  const raw = unb64(LEAF);
  raw[raw.length - 40] ^= 1;
  assertFalse(await verifyCert(new x509.X509Certificate(raw), cert(INT)));
});
