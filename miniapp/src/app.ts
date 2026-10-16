import Taro from "@tarojs/taro";
import { Component, type PropsWithChildren } from "react";

class App extends Component<PropsWithChildren> {
  private lastEntry = "";
  componentDidShow() {
    const options = Taro.getEnterOptionsSync();
    const scene = options.query?.scene;
    if (!scene) return;
    const signature = `${options.path}:${scene}`;
    if (signature === this.lastEntry) return;
    this.lastEntry = signature;
    if (Taro.getCurrentPages().length) {
      const path =
        options.path === "pages/registration/index"
          ? options.path
          : "pages/encounter/index";
      void Taro.reLaunch({
        url: `/${path}?scene=${encodeURIComponent(scene)}`,
      });
    }
  }

  render() {
    return this.props.children;
  }
}

export default App;
