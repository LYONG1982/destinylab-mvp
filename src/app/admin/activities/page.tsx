import { Suspense } from "react";
import { AdminApp } from "@/features/admin/AdminApp";
export default function Page() {
  return (
    <Suspense>
      <AdminApp page="activities" />
    </Suspense>
  );
}
