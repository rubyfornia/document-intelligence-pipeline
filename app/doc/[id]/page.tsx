import DocView from "@/components/DocView";
export default function Page({ params }: { params: { id: string } }) {
  return <DocView id={params.id} />;
}
