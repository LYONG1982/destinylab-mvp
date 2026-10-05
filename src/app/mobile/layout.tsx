import { CityResponseBoundary } from "@/components/motion/CityResponseToast";
import { MobileMotionBoundary } from "@/components/motion/SignalMotion";
export default function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <MobileMotionBoundary>
      <CityResponseBoundary>{children}</CityResponseBoundary>
    </MobileMotionBoundary>
  );
}
