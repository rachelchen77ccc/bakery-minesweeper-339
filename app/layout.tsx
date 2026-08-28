import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "339 心动烘焙游戏屋",
  description: "和小顾、小温与机器人 339 一起玩甜蜜扫雷和牛角包摆盘。",
  icons: {
    icon: "/assets/339.png",
    shortcut: "/assets/339.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
