import ReactDOM from "react-dom/client";
import App from "./App";

// 不用 StrictMode：开发模式下它会双调用 effect，
// 导致缩略图抽两遍、事件监听重复注册。
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
