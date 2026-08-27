import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "心动烘焙扫雷",
  description: "和小顾、小温与机器人 339 一起寻找香喷喷的早餐。",
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
