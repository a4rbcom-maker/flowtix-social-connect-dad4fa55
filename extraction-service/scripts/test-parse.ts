import { parseGraphQLResponse } from "../src/services/graphql-interceptor.js";
import fs from "fs";
for (let i = 0; i < 3; i++) {
  const f = `probe-response-${i}.json`;
  if (!fs.existsSync(f)) continue;
  const body = fs.readFileSync(f, "utf8");
  const result = parseGraphQLResponse(body);
  console.log(`${f}: users=${result.users.length} cursor=${result.endCursor?.substring(0,20)} hasNext=${result.hasNextPage}`);
  if (result.users.length > 0) {
    console.log('  First user:', JSON.stringify(result.users[0]).substring(0, 150));
  }
}
