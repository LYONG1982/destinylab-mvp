import { Suspense } from "react";
import { MobileApp } from "@/features/mobile/MobileApp";
export default function Page() {
  return (
    <Suspense>
      <MobileApp page="07-invitation" />
    </Suspense>
  );
}
