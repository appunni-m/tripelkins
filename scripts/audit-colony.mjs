import { auditColony } from "../src/game/colony-audit.js";
const report = await auditColony({seconds:Number(process.argv[2])||300});
console.log(JSON.stringify(report,null,2));
