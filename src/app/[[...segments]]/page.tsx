import Workspace from "../../Workspace";
export default async function Page({
  params,
}: {
  params: Promise<{ segments?: string[] }>;
}) {
  const { segments = [] } = await params;
  return <Workspace path={"/" + segments.join("/")} />;
}
