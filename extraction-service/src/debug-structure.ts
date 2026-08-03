import * as fs from "fs";

const raw = fs.readFileSync("C:\\Users\\COMPUC~1\\AppData\\Local\\Temp\\opencode\\gql_full.json", "utf-8");
const data = JSON.parse(raw);

// Find where creation_time lives in the depth structure
function findKeyPaths(obj: any, target: string, path: string, depth: number, results: string[]): void {
  if (!obj || depth > 10) return;
  if (typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (let i = 0; i < Math.min(obj.length, 5); i++) findKeyPaths(obj[i], target, `${path}[${i}]`, depth + 1, results);
    return;
  }
  for (const k of Object.keys(obj)) {
    if (k === target) { results.push(`${path}.${k} = ${JSON.stringify(obj[k]).substring(0, 80)}`); }
    if (typeof obj[k] === "object" && obj[k] !== null) {
      findKeyPaths(obj[k], target, `${path}.${k}`, depth + 1, results);
    }
  }
}

console.log("=== creation_time paths ===");
const ctPaths: string[] = [];
findKeyPaths(data, "creation_time", "root", 0, ctPaths);
for (const p of ctPaths.slice(0, 40)) console.log(p);

console.log("\n=== id paths (numbers only) ===");
const idPaths: string[] = [];
findKeyPaths(data, "id", "root", 0, idPaths);
for (const p of idPaths.filter(p => /\d{8,}/.test(p)).slice(0, 40)) console.log(p);

console.log("\n=== message paths ===");
const msgPaths: string[] = [];
findKeyPaths(data, "message", "root", 0, msgPaths);
for (const p of msgPaths.slice(0, 20)) console.log(p);

console.log("\n=== actor paths ===");
const actorPaths: string[] = [];
findKeyPaths(data, "actor", "root", 0, actorPaths);
for (const p of actorPaths.slice(0, 20)) console.log(p);

console.log("\n=== reaction_type paths ===");
const rtPaths: string[] = [];
findKeyPaths(data, "reaction_type", "root", 0, rtPaths);
for (const p of rtPaths.slice(0, 20)) console.log(p);

console.log("\n=== text paths (first 10) ===");
const textPaths: string[] = [];
findKeyPaths(data, "text", "root", 0, textPaths);
for (const p of textPaths.slice(0, 10)) console.log(p);
