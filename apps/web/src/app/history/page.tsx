import { SessionList } from "@/components/history/session-list";

export default function HistoryPage() {
  return (
    <div className="container py-8 max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">研究历史</h1>
      <SessionList />
    </div>
  );
}
