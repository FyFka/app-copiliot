import { Chat } from "@/widgets";
import { Group, Panel } from "react-resizable-panels";

export const Home = () => {
  return (
    <div className="h-full">
      <Group>
        <Panel minSize={160} defaultSize={386}>
          <Chat />
        </Panel>
        <Panel />
      </Group>
    </div>
  );
};
