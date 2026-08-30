import { parseGraphQLResponse } from "../src/services/graphql-interceptor.js";
import fs from "fs";
const body = fs.readFileSync('probe-response-2.json', 'utf8');
const result = parseGraphQLResponse(body);
console.log('Users from probe-response-2:');
for (const u of result.users) {
  console.log(`  id=${u.id} name=${u.name} url=${u.url?.substring(0,50)}`);
}
