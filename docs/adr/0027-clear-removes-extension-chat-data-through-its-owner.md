# Clear removes every piece of Extension Chat Data through its owner

Clear removes all Extension Chat Data — the Chat Store, the stable message identifiers, and the message token cache — and each shape is removed by the module that writes it, so no caller decides ownership by inspecting a key name.

## Considered Options

- **Identifying extension-owned message extras by the `sc_` key prefix** — a naming convention doing an ownership's job: the message token cache self-heals on a text-length mismatch, while a prefix sweep would hide which module owns each piece of data.
- **Owners registering their removals into a registry** — rejected for a closed set of four with real ordering: the store and the Ghosting ownership go before the message payloads, and persistence goes last, so a registry would hide the order that makes the reset correct.
- **Deleting the chat-metadata key instead of emptying the store in place** — the deletion is transient, because `getChatStore()` recreates the key on read and every persist passes through it, and it forces the reset onto a second, hand-rolled write path beside the one writer.

## Consequences

A key that no live module declares survives Clear forever, including one that happens to start with `sc_`: the prefix sweep is gone, and there are no migration shims.
