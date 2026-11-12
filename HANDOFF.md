# Handoff: learning Unity multiplayer (p2p-physics-test)

Read this first in a new session. It's what the user and Claude settled on 2026-11-11, so questions don't need the
same background again.

## Who and what

- The user is learning **Unity networking by writing it themselves**. They come from **Roblox**: explain things by
  mapping them to Roblox where it helps (ScreenGui = Canvas, RemoteEvent = RPC, and so on).
- **How to help:**
  - Premake scenes, prefabs and UI objects (components only).
  - Don't write their gameplay scripts unless they ask.
  - Explain bigger ideas first, then code a few lines at a time.
- They plan to **restart UnityStaycation themselves**. Ignore its old Unity code; don't point to it or build on it.
- They're starting with **Code Monkey's Netcode for GameObjects course** (see Learning plan).

## The project

- **Path:** `C:\Users\jakeb\Desktop\Game Development\Personal\Unity\p2p-physics-test`, Unity **6000.0.34f1**, URP.
- **Packages** (`Packages/manifest.json`; the old one is `manifest.json.bak`):
  - Netcode for GameObjects **2.13.3** (Unity Transport comes with it)
  - Multiplayer Play Mode **1.3.3**
  - Multiplayer Tools **2.2.12** (Network Simulator and profiler)
  - MCP for Unity **v10.3.0** (git: CoplayDev/unity-mcp)
  - Input System 1.11.2
  - TextMeshPro, built into uGUI. Its Essentials are imported (`Assets/TextMesh Pro`)

## Reaching the editor from Claude

- Unity connects to MCP for Unity's **HTTP server at `http://127.0.0.1:8080/mcp`**. A session whose built-in
  `mcp__unityMCP__*` tools say "No Unity Editor instances found" is on the old stdio link and can't see it.
- **Workaround:** the HTTP client scripts saved in this project's `Tools~/` folder. Unity ignores folders ending in `~`.
  - `node "Tools~/mcp.js" <tool> '<json args>'` calls any MCP tool. Examples: `read_console`, `manage_scene`, `manage_packages`.
  - `node "Tools~/runcode.js" <file.cs>` runs a C# file through `execute_code`.
    - It uses the CodeDom compiler (C# 6): fully qualify `UnityEngine.Object`, and don't use newer C# syntax.
    - It's a method body: end it with `return "...";`.
- A fresh session may pick up the HTTP server natively, so try the built-in tools first.

## What's in the scene (`Assets/Scenes/SampleScene`)

| Object | Notes |
| --- | --- |
| `Level` | the floor, steps (0.3, 0.6, 1.0, 1.4 m), a 20° and a 55° ramp, a low ceiling on posts, and a wall |
| `Boxes` | 6 instances of the Box prefab (in-scene NetworkObjects, IDs generated) |
| `NetworkManager` | Unity Transport on **127.0.0.1:7777**, **Tick Rate 60**, Player Prefab set, the prefab list, the Network Simulator (no lag) |
| `EventSystem` | uses InputSystemUIInputModule |
| `DevCanvas` | **dev Host and Client buttons, top right**, run by `Assets/Scripts/Dev/DevNetworkButtons.cs`; they hide once connected. Delete when no longer needed |
| `Canvas` | **the user's own**. They deleted the premade `UI` menu and HUD and started their own |
| `Main Camera` | an overview shot; its AudioListener was removed |

- **Prefabs** (`Assets/Prefabs/`), with every component set up but no scripts:
  - `Player`: a CharacterController (1.8 m tall, 0.35 radius, step 0.4, skin 0.03, min move 0), a NetworkObject, a NetworkTransform (Owner authority, position plus yaw), a blue body, a yellow nose, and a `ViewCamera` at 1.6 m with its Camera and AudioListener off.
  - `Box`: a 0.5 m cube with a Rigidbody (Continuous Dynamic), a NetworkObject (Don't Destroy With Owner), and a NetworkTransform (Owner).
- **Prefab list:** `Assets/DefaultNetworkPrefabs.asset` holds both.
- **The user's scripts:** `Assets/Scripts/MenuUI.cs`, still Unity's empty template.

At handoff, the scene had **unsaved changes** (their deleted UI, their new Canvas, and the DevCanvas). Multiplayer
Play Mode's extra players load the scene from disk, so **remind them to Ctrl+S before Play**.

## The guide

- `GUIDE-p2p-character-controller.md` in this project (copy: `UnityStaycation/tutorials/GUIDE-p2p-character-controller.md`).
- **Layout:** each script is built step by step, each bigger idea explained first, and each script ends with a full listing.
- **Sections:**
  1. the big picture
  2. the premade scene
  3. the menu (sessions, transport and addresses, the life of a button click, events and callbacks, `MenuUI`)
  4. the player (`PlayerMotor`)
  5. pushes (RPCs, `ServerPush`, `TestBlast`)
  6. remote colliders on the host
  7. pick up and throw (NetworkVariables, ownership, `Grabbable`, `PlayerHands`, `HudUI`)
  8. the two-person carry pattern
  9. testing under lag
  10. going online
  11. mistakes everyone makes
  12. exercises
- **Its section 3 assumes the premade `UI` objects**, which the user has since deleted. Either wire `MenuUI` to their
  own Canvas or rebuild the premade UI.
- **Status:** every stage of every script compiles in the guide's order, checked with Unity's Roslyn against
  UnityStaycation's `Assembly-CSharp.csproj` references. **Nothing has been run in Play mode.**
- An older tutorial, `p2p-physics-characters.md` (physics-body players), is in `UnityStaycation/tutorials/`.

## Decisions already made (don't relitigate)

- **Netcode for GameObjects, not Mirror:** first-party, it's what Multiplayer Play Mode, Multiplayer Tools and Unity's join-code services are built around, and the guide uses it.
- **A CharacterController, not physics-body players**, for this project. Pushes go through one "outside forces" layer: the host sends `PushRpc` to the owner, who adds it to its own movement.
- **Remote players keep their CharacterController enabled**, so the host has a collider for each of them.
- **Tick rate 60.** It's session-wide and can't differ per player; rendering stays smooth per frame regardless.
- **Plain interpolation by default.** A carried player is drawn at the carriers' hands on every screen (attachment by presentation), because synced positions would trail by about two pings.
- **Two-person carry:** two players gripping a food means it loses control and is carried between them; one gripper does nothing.
- **The connection path:**
  1. `127.0.0.1` in Multiplayer Play Mode for building;
  2. **Unity Relay with join codes** (the Multiplayer Services "sessions" package) for internet tests;
  3. **Steam lobbies and the Steam transport** before a Steam release (free test app id **480**).

  Only the menu and connection code change between them.

## Already explained to the user (point back to these)

- Roblox to Netcode mapping; P2P client hosting; the four rules (the server decides, each player moves itself, physics follows ownership, state versus moments).
- Unity UI: canvas render modes (Overlay, Camera, World Space), what IMGUI/`OnGUI` is versus uGUI, and the life of a click.
- `SetConnectionData`, address and port, `127.0.0.1`, listen address `0.0.0.0`; how Start Client finds the host (no discovery: it goes to the transport's address).
- Events and callbacks (`+=` / `-=`, Roblox's `:Connect`); `OnClientConnectedCallback` and `OnClientDisconnectCallback`.
- What a relay is and why routers need one (versus port forwarding); join codes.
- Multiplayer Play Mode's limits: it tests the logic, not real lag, firewalls, the internet, two PCs, or Steam.
- The CharacterController API (`Move`, `isGrounded`, `stepOffset`, `OnControllerColliderHit`, teleport snapping).
- Gang Beasts and PEAK: host-simulated active ragdolls versus owner-simulated players. Burglin' Gnomes is a close competitor to UnityStaycation's pitch.
- Mirror and FizzySteamworks: what they are, and the attribute mapping to Netcode.

## Learning plan and resources

The order:
1. Unity's official intro.
2. Code Monkey (which the user is doing first).
3. This guide.
4. Unity's sessions tutorial, for join codes.

**Code Monkey's course was made on Unity 2022 and Netcode 1.x** (around 2023). Advice already given:
- Match his exact Unity version through Unity Hub for a smooth binge, or expect small fixes in Unity 6.
- Use Multiplayer Play Mode instead of ParrelSync.
- `[ServerRpc]` and `[ClientRpc]` still work; the newer form is `[Rpc(SendTo.Server)]`.
- "Only the owner can invoke a ServerRpc" means `RequireOwnership = false`.
- Replace `ClientNetworkTransform` with Authority Mode: Owner.
- `velocity` is now `linearVelocity`, and `FindObjectOfType` is now `FindFirstObjectByType`.
- His Lobby and Relay chapters use the old separate packages: deprecated in Unity 6 but working. He stores the relay code inside the lobby data. No Steam.

**Links:**
- Unity Learn, Get started with Netcode for GameObjects: https://learn.unity.com/tutorial/get-started-with-netcode-for-gameobjects
- Netcode Hello World: https://mp-docs.dl.it.unity3d.com/netcode/2.1.1/tutorials/helloworld
- Code Monkey's course (listing): https://classcentral.com/classroom/youtube-complete-unity-multiplayer-tutorial-netcode-for-game-objects-130325
- Multiplayer Services, build your first session: https://docs.unity.com/en-us/mps-sdk/tutorials/build-your-first-session
- Relay with Netcode: https://docs.unity.com/relay/relay-and-ngo.html
- Sessions overview: https://docs.unity.com/en-us/mps-sdk/sessions-overview
- Lobby holding the relay code (community): https://uhiyama-lab.com/en/notes/unity/unity-netcode-relay-lobby-online-session/
- Steam with Netcode (Facepunch): https://www.github.com/MrRobinOfficial/Guide-UnitySteamNetcodeGameObjects and https://www.Github.com/ErencanPelin/Steam-Multiplayer-Networking-for-Unity
- Theory: Gabriel Gambetta's Fast-Paced Multiplayer, Gaffer on Games (Glenn Fiedler), Valve's Source Multiplayer Networking

## Next steps for the user

1. Save the scene, then try the DevCanvas Host and Client buttons in two Play Mode windows.
2. Work through Code Monkey, then come back to the guide from section 3 (wiring `MenuUI` to their own Canvas), and section 4 (`PlayerMotor`).
3. Bring errors to Claude with the exact Console message and the script.
