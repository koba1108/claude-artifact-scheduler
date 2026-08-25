# Claude Code instructions

実装・レビューを始める前に、ルートの [`AGENTS.md`](./AGENTS.md) を読み、その制約を最優先してください。

ソースはReact + TypeScript + Tailwind CSS、ローカルのビルド環境はVite + Bunです。本番成果物はGitへ含める `dist/index.html` 1ファイルで、設計の正本は `docs/DESIGN.md` です。生成物を直接編集せず、変更後は必ず次を実行します。

```bash
bun run verify
git diff --check
```
