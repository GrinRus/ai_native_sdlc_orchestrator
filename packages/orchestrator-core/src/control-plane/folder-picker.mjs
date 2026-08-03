import { execFileSync } from "node:child_process";
import path from "node:path";

function run(command, args, exec = execFileSync) {
  const output = exec(command, args, { encoding: "utf8", timeout: 120_000, windowsHide: true });
  const selected = String(output ?? "").trim();
  return selected ? path.resolve(selected) : null;
}

export function openNativeFolderPicker(options = {}) {
  const platform = options.platform ?? process.platform;
  const exec = options.exec ?? execFileSync;
  try {
    if (platform === "darwin") {
      return { status: "selected", path: run("osascript", ["-e", "POSIX path of (choose folder with prompt \"Choose a Git repository\")"], exec) };
    }
    if (platform === "win32") {
      const script = "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; if($d.ShowDialog() -eq 'OK'){Write-Output $d.SelectedPath}";
      return { status: "selected", path: run("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], exec) };
    }
    for (const [command, args] of [["zenity", ["--file-selection", "--directory", "--title=Choose a Git repository"]], ["kdialog", ["--getexistingdirectory", "."]]]) {
      try {
        const selected = run(command, args, exec);
        if (selected) return { status: "selected", path: selected };
      } catch { /* try next picker */ }
    }
    return { status: "unavailable", path: null, recovery: "Enter an absolute path manually." };
  } catch (error) {
    return { status: "unavailable", path: null, recovery: "Enter an absolute path manually.", detail: error instanceof Error ? error.message : String(error) };
  }
}
