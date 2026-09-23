/**
 * Thin channel boundary used by the reply pipeline. Adapters only need to
 * provide sendText(); presence and profile names are optional conveniences.
 */
export function createChannelAdapter({ sendText, setComposing, getContactName }) {
  if (typeof sendText !== "function") throw new Error("channel adapter requires sendText");
  return {
    sendText,
    setComposing: typeof setComposing === "function" ? setComposing : async () => {},
    getContactName: typeof getContactName === "function" ? getContactName : () => null,
  };
}
