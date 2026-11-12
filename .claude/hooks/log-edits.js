const fs = require("fs");
const path = require("path");

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(input);
    const toolInput = data.tool_input || {};
    const file = toolInput.file_path || toolInput.notebook_path || "unknown";

    const root = process.env.CLAUDE_PROJECT_DIR || data.cwd || process.cwd();
    const relativeFile = path.relative(root, file) || file;

    const logDir = path.join(root, ".claude", "logs");
    fs.mkdirSync(logDir, { recursive: true });

    const time = new Date().toLocaleString("sv-SE", { timeZone: "Europe/Madrid" });
    fs.appendFileSync(path.join(logDir, "edits.log"), `${time} | ${data.tool_name} | ${relativeFile}\n`);
  } catch (error) {}
  process.exit(0);
});