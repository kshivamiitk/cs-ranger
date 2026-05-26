import { CreatorTourBoot } from "@/components/creator/CreatorTour";

// Wraps every /creator/* route. The only thing it adds is the tour boot
// component, which reads localStorage on every navigation and resumes the
// onboarding tour if it's in-progress. Children pages keep rendering their
// own <Navbar /> and <Footer /> as before.
export default function CreatorLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <CreatorTourBoot />
      {children}
    </>
  );
}
