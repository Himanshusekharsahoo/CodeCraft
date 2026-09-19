import HomeComponent from "@/components/Home";

export const metadata = {
  title: "CodeCraft IDE — AI-Powered Collaborative Developer Platform",
  description: "An AI-powered collaborative browser IDE for writing, reviewing, executing, and improving code together in real time.",
};

export default function Home() {
  return (
    <main>
      <HomeComponent />
    </main>
  );
}
