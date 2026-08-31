import DocView from "@/components/DocView";
export default function Page({ params, searchParams }: { params: { id: string }; searchParams: { tab?: string } }) {
  return <DocView id={params.id} initialTab={searchParams.tab} />;
}
