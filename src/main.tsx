import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("アプリの描画先が見つかりません。");

// StrictModeの開発時二重実行でwindow.storageへの読み書きを重複させない。
createRoot(root).render(<App />);
