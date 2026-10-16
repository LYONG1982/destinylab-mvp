import { Suspense } from "react";
import { RegistrationApp } from "@/features/registration/RegistrationApp";
export const metadata = {
  title: "在凤城，认真遇见一个人 · 遇见报名",
  robots: { index: false, follow: false },
};
export default function Page() {
  return (
    <Suspense fallback={<p>正在打开报名入口…</p>}>
      <RegistrationApp />
    </Suspense>
  );
}
