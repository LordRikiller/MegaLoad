"""Post a Claude reply to a MegaBugs ticket via gh CLI.

Updates the ticket JSON (tickets/{id}.json) and the index.json entry's
updated_at + message_count. Status changes use the optional --status arg
(e.g. open -> in-progress).

Usage:
    python post_reply.py <ticket_id> <text_file> [--status in-progress]

text_file is a path to a UTF-8 file holding the reply body. Always pass UTF-8
text with em-dashes / non-ASCII intact (per python-utf8-on-windows feedback).
"""

import argparse
import base64
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

CLAUDE_USER_ID = "00000000-0000-0000-0000-000000000001"
CLAUDE_NAME = "Claude"
REPO = "LordRikiller/MegaBugs"


def gh_get(path: str):
    out = subprocess.check_output(
        ["gh", "api", f"repos/{REPO}/contents/{path}"],
        text=True,
        encoding="utf-8",
    )
    data = json.loads(out)
    content = base64.b64decode(data["content"]).decode("utf-8")
    return content, data["sha"]


def gh_put(path: str, content_str: str, message: str, sha: str):
    body = {
        "message": message,
        "content": base64.b64encode(content_str.encode("utf-8")).decode("ascii"),
        "sha": sha,
    }
    body_path = Path("C:/tmp/megabugs_put_body.json")
    body_path.parent.mkdir(parents=True, exist_ok=True)
    body_path.write_text(json.dumps(body), encoding="utf-8")
    subprocess.check_call(
        [
            "gh",
            "api",
            f"repos/{REPO}/contents/{path}",
            "-X",
            "PUT",
            "--input",
            str(body_path),
        ]
    )


def main():
    p = argparse.ArgumentParser()
    p.add_argument("ticket_id")
    p.add_argument("text_file")
    p.add_argument("--status", choices=["open", "in-progress", "closed"], default=None)
    args = p.parse_args()

    text = Path(args.text_file).read_text(encoding="utf-8").rstrip()
    if not text:
        print("Empty reply text", file=sys.stderr)
        sys.exit(1)

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # Update ticket
    ticket_path = f"tickets/{args.ticket_id}.json"
    content, sha = gh_get(ticket_path)
    ticket = json.loads(content)

    msg_num = len(ticket["messages"]) + 1
    ticket["messages"].append(
        {
            "id": f"msg-{msg_num:03d}",
            "author_id": CLAUDE_USER_ID,
            "author_name": CLAUDE_NAME,
            "text": text,
            "images": [],
            "timestamp": now,
            "is_admin": True,
        }
    )
    ticket["updated_at"] = now
    if args.status:
        ticket["status"] = args.status
    new_content = json.dumps(ticket, indent=2, ensure_ascii=False) + "\n"
    gh_put(ticket_path, new_content, f"Reply to ticket {args.ticket_id}", sha)

    # Update index entry
    idx_content, idx_sha = gh_get("index.json")
    idx = json.loads(idx_content)
    items = idx if isinstance(idx, list) else idx.get("tickets") or idx.get("items") or []
    for entry in items:
        if entry.get("id") == args.ticket_id:
            entry["updated_at"] = now
            entry["message_count"] = len(ticket["messages"])
            if args.status:
                entry["status"] = args.status
            break
    new_idx = json.dumps(idx, indent=2, ensure_ascii=False) + "\n"
    gh_put("index.json", new_idx, f"Update index for {args.ticket_id} reply", idx_sha)

    print(f"Replied to {args.ticket_id} (msg-{msg_num:03d}); status={ticket['status']}")


if __name__ == "__main__":
    main()
