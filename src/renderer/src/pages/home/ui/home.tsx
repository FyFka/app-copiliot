import { Chat } from "@/widgets";
import { Group, Panel, Separator } from "react-resizable-panels";

export const Home = () => {
  return (
    <Group orientation="horizontal" className="h-full">
      {/* Empty spacer: the app underneath shows through here. */}
      <Panel />
      <Separator
        data-interactive
        className="w-1 pointer-events-auto cursor-col-resize bg-transparent hover:bg-stroke-separator transition-colors"
      />
      <Panel minSize="280px" defaultSize="386px" maxSize="720px">
        <Chat />
      </Panel>
    </Group>
  );
};
