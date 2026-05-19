import { InputForm } from "@/components/research/input-form";

export default function HomePage() {
  return (
    <div className="container py-16 flex flex-col items-center">
      <div className="text-center mb-10">
        <h1 className="text-4xl font-bold tracking-tight mb-3">
          结构化尽职调查
        </h1>
        <p className="text-lg text-muted-foreground max-w-xl">
          拆解假设，多源检索，交叉验证 —— 输出带置信度的决策报告
        </p>
      </div>
      <InputForm />
    </div>
  );
}
