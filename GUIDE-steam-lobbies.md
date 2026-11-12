# Connecting players with Steam lobbies

This guide adds Steam to `p2p-physics-test`. Players can host a game, find it in a list, join it by ID or from a
Steam invite, and play over Steam's relay network. Nobody needs an IP address or port forwarding. You'll type every
script yourself; the menu itself is premade.

It follows on from `GUIDE-p2p-character-controller.md` and reuses its ideas: `[SerializeField]`, `AddListener`,
events with `+=` and `-=`, and the menu falling back on disconnect (section 3). Where an idea was explained there, this
guide points back to it rather than repeating it.

**What you'll build:**

| Script | Lives on | Its job |
| --- | --- | --- |
| `SteamBootstrap` | `NetworkManager` | starts Steam once, keeps it running, stops it on quit |
| `SteamTransport` | `NetworkManager` | carries Netcode's bytes over Steam (a copy of a community transport, with 3 changes) |
| `SteamLobby` | `NetworkManager` | hosts, finds, joins and leaves Steam lobbies; picks which transport to use |
| `LobbyMenuUI` | the `LobbyMenu` prefab | buttons and text only; asks `SteamLobby` to do things and shows the results |

Checked against your packages: every script compiles in the order below against Unity 6000.0.34f1, Netcode for
GameObjects 2.13.3 and Facepunch.Steamworks 2.3.2. **Nothing has been run in Play mode yet**, and the two-PC test at the
end is the real proof.

---

## 0. Can I test this on one PC?

**Partly.** You need two machines for the Steam part.

- **Steam allows one signed-in account per PC.** Every window on your PC, including Multiplayer Play Mode's extra
  players, is the **same Steam user**. A Steam user can't connect to itself, so two windows on one PC can't test a
  Steam connection.
- **So the menu has two ways in:**
  - **Local test (no Steam):** the `Host` and `Join` buttons in the bottom row use Unity Transport on `127.0.0.1`,
    exactly like your DevCanvas buttons. Use these with Multiplayer Play Mode every day while you build gameplay.
  - **Steam:** use these on **two PCs with two Steam accounts**. Your desktop and your laptop are ideal. The second
    account is free, and both can be on the same Wi-Fi: Steam routes the traffic through its relays either way.

Section 9 walks through the two-PC test step by step.

---

## 1. The idea: a lobby and a session are two different things

Roblox hides all of this: you press Play, Roblox finds a server and puts you in it. With Steam you build it from two
separate layers.

| Layer | What it is | Roblox comparison | Code |
| --- | --- | --- | --- |
| **Steam lobby** | a small "room" on Steam's servers: a member list plus a few key/value notes (game name, "this is p2p-physics-test") | the server list on a game's page, and "Join friend" | `SteamMatchmaking`, `Lobby` |
| **Netcode session** | the actual game: players, NetworkObjects, RPCs, NetworkVariables | the game server you end up in | `NetworkManager`, your scripts |

The lobby is how people **find each other**; the session is how they **play**. The glue between them is one fact:
**the lobby's owner is the host**. Every member can read the owner's Steam ID from the lobby, and the Steam transport
connects to a Steam ID instead of an IP address. Section 11 traces that link end to end.

**Steam App ID 480.** Every Steam game has an App ID. Yours doesn't exist until you pay Valve's Steam Direct fee, so for
testing everyone uses **480, "Spacewar"**, Valve's sample game. Thousands of other developers' test lobbies live under
480 too, which is why your lobbies carry a note (`game = p2p-physics-test`) and the lobby list filters on it. While
you test, Steam shows you as "playing Spacewar". Before release you swap 480 for your own ID in one place.

**Steam Datagram Relay.** Traffic goes through Valve's relay servers rather than straight between PCs. That means no
port forwarding, players never see each other's IP address, and connections work through almost any home router. It
plays the role Unity Relay plays in Unity's join-code tutorials.

---

## 2. Installing the Steam package

You'll use **Facepunch.Steamworks**, a friendly C# wrapper around Steam's API, plus Unity's community **Facepunch
transport** for Netcode. One package contains both.

1. Open **Window > Package Manager**.
2. Click **+** (top left) > **Install package from git URL...**
3. Paste this and click **Install**:
   ```
   https://github.com/Unity-Technologies/multiplayer-community-contributions.git?path=/Transports/com.community.netcode.transport.facepunch#0fab638470379ace12b0149dfb41c043d23dbce5
   ```
   The `#0fab638...` on the end pins an exact version, one already known to compile with Netcode 2.13.3. Without it,
   you'd get whatever the repository holds today.
4. Wait for it to compile. The Console should stay free of red errors.
5. **Restart the Unity editor.** Steam's native library (`steam_api64.dll`) only loads cleanly into a fresh editor.
6. **Make sure Steam is running and signed in** whenever you press Play. Without it, the Steam buttons switch off and
   only the local test works.

The package also contains its own `FacepunchTransport`. You won't use it, for the reason in section 5.

---

## 2b. The premade menu

Two prefabs are ready in `Assets/Prefabs/UI/`, with every object and layout component set up and **no scripts**:

**`LobbyMenu`**: a Screen Space Overlay canvas (sort order 10, so it draws on top of your own Canvas):

```
LobbyMenu
├── MainPanel                  the menu before you're in a game
│   ├── Title                  "Play"
│   ├── SteamStatusText        "Steam: starting..."
│   ├── HostRow
│   │   ├── HostPublicButton   "Host public"
│   │   └── HostFriendsButton  "Host friends only"
│   ├── BrowseRow
│   │   ├── BrowseLabel        "Open games"
│   │   └── RefreshButton      "Refresh"
│   ├── LobbyList              a scroll view
│   │   ├── Viewport
│   │   │   └── Content        lobby rows get added here
│   │   └── EmptyText          "Press Refresh to look for games"
│   ├── JoinIdRow
│   │   ├── LobbyIdInput       "Paste a lobby ID"
│   │   └── JoinByIdButton     "Join"
│   └── LocalRow
│       ├── LocalLabel         "Local test (no Steam)"
│       ├── LocalHostButton    "Host"
│       └── LocalJoinButton    "Join"
├── LobbyPanel (inactive)      a small top-left card while you're in a Steam game
│   ├── LobbyNameText
│   ├── LobbyIdRow
│   │   ├── LobbyIdText        "ID: -"
│   │   └── CopyIdButton       "Copy"
│   ├── PlayersHeader          "Players"
│   ├── PlayerListText
│   ├── InviteButton           "Invite friends"
│   └── LeaveButton            "Leave"
└── StatusText                 bottom centre: "Connecting...", errors, hints
```

**`LobbyRow`**: one row of the lobby list: a Button with `NameText` and `PlayersText` ("1/4"). Your code makes one per
lobby found.

**Put it in the scene:** drag `Assets/Prefabs/UI/LobbyMenu` into the Hierarchy. Leave your own `Canvas` alone; it's for
your HUD. The `DevCanvas` Host/Client buttons do the same job as the new Local row, so you can delete `DevCanvas` once
the Local row works.

> If Unity says SampleScene has unsaved changes the first time you save, that's expected: creating the prefabs touched
> the scene's "changed" flag, though nothing in the scene changed.

---

## 3. Script 1: `SteamBootstrap`, starting Steam

### The idea: one owner for Steam's lifetime

Steam must be **started once** when the game opens and **stopped once** when it quits. In between, someone has to call
`SteamClient.RunCallbacks()` every frame. That's how Steam delivers its answers ("your lobby was created", "a friend
joined"). If nothing calls it, every Steam request waits forever.

If several scripts each start or stop Steam, they fight. So exactly one script owns it. (The package's own transport
breaks this rule, which is why section 5 copies and changes it.)

### Step 3.1: start Steam

Create `Assets/Scripts/Networking/SteamBootstrap.cs`:

```csharp
using Steamworks;
using UnityEngine;

public class SteamBootstrap : MonoBehaviour
{
    [SerializeField] private uint appId = 480;

    public static bool IsReady { get; private set; }

    private void Awake()
    {
        SteamClient.Init(appId, false);
        IsReady = true;
    }
}
```

What each piece does:
- **`using Steamworks;`** brings in Facepunch's classes. `SteamClient` is the "Steam itself" class.
- **`uint appId = 480`**: `uint` is a whole number that can't be negative, which is what Steam uses for App IDs.
- **`public static bool IsReady { get; private set; }`**: a **static** property belongs to the class, not to one
  object, so any script can ask `SteamBootstrap.IsReady` without a reference. `private set` means only this script can
  change it. It's like a value in a ModuleScript that every script can read.
- **`SteamClient.Init(appId, false)`** connects to the Steam app running on your PC. The `false` means "don't run
  callbacks on a background thread; I'll run them myself on the main thread". Unity's API only works on the main
  thread, so this keeps every Steam answer safe to use with UI and GameObjects.
- **`Awake`**, not `Start`: Awake runs first, so Steam is up before any other script's `Start` asks about it.

### Step 3.2: survive Steam not running

If Steam isn't open, `Init` **throws an exception**, an error that stops the method. Catch it, so the game still opens
and the local test still works. Replace the body of `Awake`:

```csharp
    private void Awake()
    {
        try
        {
            SteamClient.Init(appId, false);
            IsReady = true;
            Debug.Log("Steam ready. Signed in as " + SteamClient.Name);
        }
        catch (System.Exception e)
        {
            IsReady = false;
            Debug.LogWarning("Steam didn't start. Is Steam running and signed in? " + e.Message);
        }
    }
```

- **`try { ... } catch (System.Exception e) { ... }`** is Luau's `pcall`: run the first block, and if anything in it
  errors, jump to the second block instead of crashing. `e` holds the error.
- **`SteamClient.Name`** is your Steam display name: a quick proof that it worked.

### Step 3.3: the relay, and a second Play press

Two small additions. First, add this line right after `SteamClient.Init(appId, false);`:

```csharp
            SteamNetworkingUtils.InitRelayNetworkAccess();
```

This starts connecting to Valve's relay network straight away, so the first connection later is faster.

Second, add this at the very **top** of `Awake`, before `try`:

```csharp
        if (SteamClient.IsValid)
        {
            IsReady = true;
            return;
        }
```

`SteamClient.IsValid` is true when Steam is already started. That can happen in the editor when Unity is set to skip
reloading scripts on Play: the old session is still alive, and calling `Init` twice errors.

### Step 3.4: callbacks every frame, and a clean stop

```csharp
    private void Update()
    {
        if (IsReady)
        {
            SteamClient.RunCallbacks();
        }
    }

    private void OnApplicationQuit()
    {
        if (IsReady)
        {
            SteamClient.Shutdown();
            IsReady = false;
        }
    }
```

- **`RunCallbacks()`** delivers every Steam answer that has arrived since the last frame. This one line makes every
  `await` in section 6 finish.
- **`OnApplicationQuit`** runs when the game closes, and also when you **stop Play mode** in the editor. Shutting
  Steam down there means the next Play press starts it fresh.

### The whole `SteamBootstrap.cs`

```csharp
using Steamworks;
using UnityEngine;

public class SteamBootstrap : MonoBehaviour
{
    [SerializeField] private uint appId = 480;

    public static bool IsReady { get; private set; }

    private void Awake()
    {
        if (SteamClient.IsValid)
        {
            IsReady = true;
            return;
        }

        try
        {
            SteamClient.Init(appId, false);
            SteamNetworkingUtils.InitRelayNetworkAccess();
            IsReady = true;
            Debug.Log("Steam ready. Signed in as " + SteamClient.Name);
        }
        catch (System.Exception e)
        {
            IsReady = false;
            Debug.LogWarning("Steam didn't start. Is Steam running and signed in? " + e.Message);
        }
    }

    private void Update()
    {
        if (IsReady)
        {
            SteamClient.RunCallbacks();
        }
    }

    private void OnApplicationQuit()
    {
        if (IsReady)
        {
            SteamClient.Shutdown();
            IsReady = false;
        }
    }
}
```

**Hook it up:** select `NetworkManager` in the Hierarchy > **Add Component > SteamBootstrap**.

**Try it:** with Steam open, press Play. The Console says "Steam ready. Signed in as (your name)", and Steam shows you
playing Spacewar. Stop Play; Steam stops showing it. Close Steam and press Play: you get the yellow warning instead,
and nothing breaks.

---

## 4. The idea: what a transport is, again

Guide section 3 called the transport the **delivery van**: Netcode decides *what* to send, and the transport carries
the bytes. Unity Transport drives to an **IP address and port**. A Steam transport drives to a **Steam ID** through
Valve's relays. Everything above the transport (your RPCs, NetworkVariables, NetworkTransforms) doesn't know or care
which van is used.

The NetworkManager holds **one active transport** in `NetworkManager.Singleton.NetworkConfig.NetworkTransport`. You'll
keep **both** components on the NetworkManager object, and `SteamLobby` will set that field to the right one just
before starting:

```
Local test buttons  →  NetworkTransport = UnityTransport  →  127.0.0.1:7777
Steam buttons       →  NetworkTransport = SteamTransport  →  the host's Steam ID
```

You can only switch while no session is running, which is always true when you press a menu button.

---

## 5. Script 2: `SteamTransport`, a copy with three changes

### The idea: why not use the package's transport?

The package's `FacepunchTransport` does two things you don't want:
1. **It starts Steam itself** in its `Initialize`, with App ID 480 hard-wired in. `SteamBootstrap` already does that.
2. **Its `Shutdown` calls `SteamClient.Shutdown()`**. Netcode shuts the transport down **every time a session
   ends**: you leave a game, the host quits, a connection fails. Each of those would switch off Steam for the whole
   game, and your next "Refresh" or "Host" would fail until you restarted.

The package is MIT licensed, so you're allowed to copy it into your project and change it. Copying a small library
file to fix its behaviour is common practice; the alternative is waiting for someone else to fix it.

### Step 5.1: copy the file

1. In the Project window, open **Packages > Facepunch Transport for Netcode for GameObjects > Runtime**.
2. Right-click `FacepunchTransport.cs` > **Show in Explorer**, and copy the file into
   `Assets/Scripts/Networking/`.
3. Rename your copy **`SteamTransport.cs`**, and open it.

### Step 5.2: rename the class and drop the namespace

The original sits inside `namespace Netcode.Transports.Facepunch { ... }`. Your other scripts don't use namespaces, so
remove that wrapper. Delete the `namespace ... {` line, the matching last `}` of the file, and the line just inside it:

```csharp
    using SocketConnection = Connection;
```

Add this with the other `using` lines at the top instead (it gives `Steamworks.Data.Connection` the short name
`SocketConnection`, which the rest of the file uses):

```csharp
using SocketConnection = Steamworks.Data.Connection;
```

Then rename the class:

```csharp
public class SteamTransport : NetworkTransport, IConnectionManager, ISocketManager
```

- **`: NetworkTransport`** means "this is a Netcode transport", so it can go in the NetworkManager's transport slot.
- **`IConnectionManager, ISocketManager`** are Facepunch **interfaces**, promises to have certain methods. Steam calls
  the `IConnectionManager` methods on a **client** (connected, a message arrived) and the `ISocketManager` ones on the
  **host**. That's the whole design of the file: Steam events come in through those methods, and get passed to Netcode
  with `InvokeOnTransportEvent`.

The class name must match the file name, `SteamTransport`, or Unity won't let you add it as a component.

### Step 5.3: change 1. Don't start Steam

Delete the `steamAppId` field (with its `[Tooltip]` and `[Space]`) and the `m_SteamInitialized` field, and delete
`OnEarlyUpdate` and `InitSteamworks` (near the bottom) completely. They started Steam and ran its callbacks, which
`SteamBootstrap` now does.

Make `Initialize` just set up the client list:

```csharp
    public override void Initialize(NetworkManager networkManager = null)
    {
        connectedClients = new Dictionary<ulong, Client>();
    }
```

Netcode calls `Initialize` at the start of every session, so this clears the list of connected players each time.

You can also delete the `userSteamId` field and its `[Header("Info")]` and `[ReadOnly]` lines: only `OnEarlyUpdate`
used them.

### Step 5.4: change 2. Don't stop Steam

Replace `Shutdown` with:

```csharp
    public override void Shutdown()
    {
        try
        {
            connectionManager?.Close();
            socketManager?.Close();
        }
        catch (Exception e)
        {
            if (LogLevel <= LogLevel.Error)
                Debug.LogError($"[{nameof(SteamTransport)}] - Caught an exception while shutting down: {e}");
        }
        connectionManager = null;
        socketManager = null;
    }
```

- **`SteamClient.Shutdown()` is gone.** The transport now closes only **its own connections**.
- **`?.`** means "only if it isn't null". A client has a `connectionManager` and no `socketManager`; the host is the
  other way round.
- **Setting both to `null`** means the next session starts clean, and `PollEvent` stops reading from closed
  connections.

### Step 5.5: change 3. No `unsafe` code

The original copies incoming messages with `UnsafeUtility.MemCpy` inside `unsafe` and `fixed` blocks. That works in a
package that allows unsafe code, but your project doesn't, so it won't compile. There's a safe method that does the
same job.

1. Delete `using Unity.Collections.LowLevel.Unsafe;` at the top.
2. In `GetCurrentRtt`, delete the word `unsafe`: `public override ulong GetCurrentRtt(ulong clientId)`.
3. In **both** `OnMessage` methods, delete `unsafe` from the first line, and replace the `fixed (...) { ... }` block
   with one line:

```csharp
        Marshal.Copy(data, payloadCache, 0, size);
```

`data` is a raw memory address Steam hands you (`IntPtr`). `Marshal.Copy` copies `size` bytes from it into the
`payloadCache` byte array, starting at position 0. (`using System.Runtime.InteropServices;` at the top already brings
in `Marshal`.)

### Step 5.6: rename the log tags

Search the file for `nameof(FacepunchTransport)` and change each one to `nameof(SteamTransport)`, so the Console shows
which transport is talking. You can also delete the `Debug.Log` lines that only print at Developer log level, to make
the file shorter. The listing below has done that.

### The whole `SteamTransport.cs`

Check your edited copy against this. The logic is the original's; only the three changes differ.

```csharp
// Based on FacepunchTransport from Unity's multiplayer-community-contributions (MIT License,
// Copyright (c) 2021 Unity Technologies). Changed so it never starts or stops Steam:
// SteamBootstrap owns Steam's lifetime.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Steamworks;
using Steamworks.Data;
using Unity.Netcode;
using UnityEngine;
using SocketConnection = Steamworks.Data.Connection;

public class SteamTransport : NetworkTransport, IConnectionManager, ISocketManager
{
    private ConnectionManager connectionManager;
    private SocketManager socketManager;
    private Dictionary<ulong, Client> connectedClients;

    [Tooltip("The host's Steam ID. The lobby code sets it before StartClient.")]
    public ulong targetSteamId;

    private LogLevel LogLevel => NetworkManager.Singleton.LogLevel;

    private class Client
    {
        public SteamId steamId;
        public SocketConnection connection;
    }

    #region NetworkTransport Overrides

    public override ulong ServerClientId => 0;

    public override void Initialize(NetworkManager networkManager = null)
    {
        connectedClients = new Dictionary<ulong, Client>();
    }

    public override bool StartServer()
    {
        socketManager = SteamNetworkingSockets.CreateRelaySocket<SocketManager>();
        socketManager.Interface = this;
        return true;
    }

    public override bool StartClient()
    {
        connectionManager = SteamNetworkingSockets.ConnectRelay<ConnectionManager>(targetSteamId);
        connectionManager.Interface = this;
        return true;
    }

    public override void Shutdown()
    {
        try
        {
            connectionManager?.Close();
            socketManager?.Close();
        }
        catch (Exception e)
        {
            if (LogLevel <= LogLevel.Error)
                Debug.LogError($"[{nameof(SteamTransport)}] - Caught an exception while shutting down: {e}");
        }
        connectionManager = null;
        socketManager = null;
    }

    public override void DisconnectLocalClient()
    {
        connectionManager?.Connection.Close();
    }

    public override void DisconnectRemoteClient(ulong clientId)
    {
        if (connectedClients.TryGetValue(clientId, out Client user))
        {
            user.connection.Flush();
            user.connection.Close();
            connectedClients.Remove(clientId);
        }
    }

    public override ulong GetCurrentRtt(ulong clientId)
    {
        return 0;
    }

    private SendType NetworkDeliveryToSendType(NetworkDelivery delivery)
    {
        return delivery switch
        {
            NetworkDelivery.Unreliable => SendType.Unreliable,
            NetworkDelivery.UnreliableSequenced => SendType.Unreliable,
            _ => SendType.Reliable
        };
    }

    public override void Send(ulong clientId, ArraySegment<byte> data, NetworkDelivery delivery)
    {
        var sendType = NetworkDeliveryToSendType(delivery);

        if (clientId == ServerClientId)
            connectionManager.Connection.SendMessage(data.Array, data.Offset, data.Count, sendType);
        else if (connectedClients.TryGetValue(clientId, out Client user))
            user.connection.SendMessage(data.Array, data.Offset, data.Count, sendType);
        else if (LogLevel <= LogLevel.Normal)
            Debug.LogWarning($"[{nameof(SteamTransport)}] - Failed to send packet to remote client with ID {clientId}, client not connected.");
    }

    public override NetworkEvent PollEvent(out ulong clientId, out ArraySegment<byte> payload, out float receiveTime)
    {
        connectionManager?.Receive();
        socketManager?.Receive();

        clientId = 0;
        receiveTime = Time.realtimeSinceStartup;
        payload = default;
        return NetworkEvent.Nothing;
    }

    #endregion

    #region ConnectionManager Implementation (this machine is a client)

    private byte[] payloadCache = new byte[4096];

    private void EnsurePayloadCapacity(int size)
    {
        if (payloadCache.Length >= size)
            return;

        payloadCache = new byte[Math.Max(payloadCache.Length * 2, size)];
    }

    void IConnectionManager.OnConnecting(ConnectionInfo info) { }

    void IConnectionManager.OnConnected(ConnectionInfo info)
    {
        InvokeOnTransportEvent(NetworkEvent.Connect, ServerClientId, default, Time.realtimeSinceStartup);
    }

    void IConnectionManager.OnDisconnected(ConnectionInfo info)
    {
        InvokeOnTransportEvent(NetworkEvent.Disconnect, ServerClientId, default, Time.realtimeSinceStartup);
    }

    void IConnectionManager.OnMessage(IntPtr data, int size, long messageNum, long recvTime, int channel)
    {
        EnsurePayloadCapacity(size);
        Marshal.Copy(data, payloadCache, 0, size);
        InvokeOnTransportEvent(NetworkEvent.Data, ServerClientId, new ArraySegment<byte>(payloadCache, 0, size), Time.realtimeSinceStartup);
    }

    #endregion

    #region SocketManager Implementation (this machine is the host)

    void ISocketManager.OnConnecting(SocketConnection connection, ConnectionInfo info)
    {
        connection.Accept();
    }

    void ISocketManager.OnConnected(SocketConnection connection, ConnectionInfo info)
    {
        if (connectedClients.ContainsKey(connection.Id))
            return;

        connectedClients.Add(connection.Id, new Client { connection = connection, steamId = info.Identity.SteamId });
        InvokeOnTransportEvent(NetworkEvent.Connect, connection.Id, default, Time.realtimeSinceStartup);
    }

    void ISocketManager.OnDisconnected(SocketConnection connection, ConnectionInfo info)
    {
        if (connectedClients.Remove(connection.Id))
            InvokeOnTransportEvent(NetworkEvent.Disconnect, connection.Id, default, Time.realtimeSinceStartup);
    }

    void ISocketManager.OnMessage(SocketConnection connection, NetIdentity identity, IntPtr data, int size, long messageNum, long recvTime, int channel)
    {
        EnsurePayloadCapacity(size);
        Marshal.Copy(data, payloadCache, 0, size);
        InvokeOnTransportEvent(NetworkEvent.Data, connection.Id, new ArraySegment<byte>(payloadCache, 0, size), Time.realtimeSinceStartup);
    }

    #endregion
}
```

Three lines in it matter most for understanding:
- **`StartServer`**: `CreateRelaySocket` opens a "door" on the relay network under **your Steam ID**. That's the
  host's equivalent of listening on port 7777.
- **`StartClient`**: `ConnectRelay(targetSteamId)` knocks on the door of the Steam ID in `targetSteamId`. That's
  the client's equivalent of `SetConnectionData("127.0.0.1", 7777)`. `SteamLobby` fills it in from the lobby.
- **`ServerClientId => 0`**: Netcode's host is always client 0, as in guide section 3.

**Hook it up:** select `NetworkManager` > **Add Component > SteamTransport**. Leave the NetworkManager's own
**Transport** slot on **UnityTransport**: the default stays local, and `SteamLobby` switches it when needed.

---

## 6. Script 3: `SteamLobby`, the lobby logic

### The idea: waiting without freezing (`async` and `await`)

Creating, finding and joining a lobby all ask Steam's servers something, and the answer takes a moment. In Luau you'd
write a yielding call: the script pauses on that line, and the game keeps running. C# does it with `async` and
`await`:

```csharp
public async void HostSteam(bool friendsOnly)
{
    Lobby? created = await SteamMatchmaking.CreateLobbyAsync(maxPlayers);
    // ...this line runs later, once Steam has answered
}
```

- **`async`** on a method allows `await` inside it.
- **`await`** pauses **this method only**. Unity carries on rendering frames, and the method continues from that
  line when the answer arrives. Here the answer arrives during `SteamBootstrap`'s `RunCallbacks()`, on the main
  thread.
- Methods that wait usually end in **`Async`** and return a **`Task`** (a promise of an answer). `Task<Lobby[]>`
  means "an answer that will be a `Lobby[]`".
- **`async void`** is for "fire and forget" methods like button handlers. A method that hands back an answer is
  `async Task<T>` instead, so its caller can `await` it.

### The idea: "maybe a lobby" (`Lobby?`)

`Lobby` is a **struct**, a value like a `Vector3`, so it can't be `null` on its own. `Lobby?` (read "nullable Lobby")
can be either a lobby **or nothing**, like a Luau variable that may be `nil`:
- `created == null` checks for nothing;
- `created.HasValue` is the same question the other way round;
- `created.Value` takes the lobby out once you know it's there.

### Step 6.1: fields and the two transports

Create `Assets/Scripts/Networking/SteamLobby.cs`:

```csharp
using System;
using System.Threading.Tasks;
using Steamworks;
using Steamworks.Data;
using Unity.Netcode;
using Unity.Netcode.Transports.UTP;
using UnityEngine;

public class SteamLobby : MonoBehaviour
{
    private const string GameKey = "game";
    private const string GameValue = "p2p-physics-test";

    [SerializeField] private int maxPlayers = 4;
    [SerializeField] private SteamTransport steamTransport;
    [SerializeField] private UnityTransport unityTransport;

    public Lobby? CurrentLobby { get; private set; }

    private void UseTransport(NetworkTransport transport)
    {
        NetworkManager.Singleton.NetworkConfig.NetworkTransport = transport;
    }
}
```

- **`const`** is a value fixed forever at compile time. `GameKey` and `GameValue` are the note every lobby of yours
  carries, so the lobby list can tell your lobbies apart from everyone else's on App ID 480.
- **`CurrentLobby`** is the lobby you're in, or nothing. Anyone can read it; only this script changes it.
- **`UseTransport`** puts one of the two "vans" in the NetworkManager's transport slot (section 4). Its parameter type
  is `NetworkTransport`, the shared parent class, so it accepts either.

### Step 6.2: telling the UI what's happening

`SteamLobby` has no buttons or text of its own. It **announces** things, and the UI listens. Add two events under
`CurrentLobby`:

```csharp
    public event Action LobbyChanged;
    public event Action<string> StatusChanged;
```

and a helper at the bottom of the class:

```csharp
    private void Status(string message)
    {
        StatusChanged?.Invoke(message);
    }
```

- **`event Action`** is your own event, the same kind as `OnClientConnectedCallback`. It's a Roblox BindableEvent:
  `LobbyChanged?.Invoke()` is `:Fire()`, and the UI's `+=` is `:Connect`.
- **`Action<string>`** is an event that passes one string, here the message to show.
- **`?.Invoke`** fires it only if someone is listening; with nobody subscribed, the event is `null`.

Keeping the logic and the UI apart means you can later build a nicer menu, or a console command, on the same
`SteamLobby` without touching it.

### Step 6.3: the local test buttons

```csharp
    public void HostLocal()
    {
        UseTransport(unityTransport);
        if (!NetworkManager.Singleton.StartHost())
        {
            Status("Couldn't host. Is another window already hosting?");
        }
    }

    public void JoinLocal()
    {
        UseTransport(unityTransport);
        Status("Connecting to 127.0.0.1...");
        if (!NetworkManager.Singleton.StartClient())
        {
            Status("Couldn't start the client.");
        }
    }
```

This is guide section 3's Host and Join, with one new line first: switch to Unity Transport, which already has
`127.0.0.1` and port 7777 set in its Inspector. The "already hosting" message covers the port error you hit earlier.

### Step 6.4: hosting a Steam lobby

```csharp
    public async void HostSteam(bool friendsOnly)
    {
        if (!SteamBootstrap.IsReady)
        {
            Status("Steam isn't running.");
            return;
        }

        Status("Creating a lobby...");
        Lobby? created = await SteamMatchmaking.CreateLobbyAsync(maxPlayers);
        if (created == null)
        {
            Status("Couldn't create a lobby.");
            return;
        }
    }
```

- **`CreateLobbyAsync(maxPlayers)`** asks Steam's servers for a new lobby with room for `maxPlayers`, with you as its
  owner. It comes back with the lobby, or nothing if it failed (no internet, Steam down).

Now set the lobby up. Add this after the `if (created == null)` block:

```csharp
        Lobby lobby = created.Value;
        if (friendsOnly)
        {
            lobby.SetFriendsOnly();
        }
        else
        {
            lobby.SetPublic();
        }
        lobby.SetJoinable(true);
        lobby.SetData(GameKey, GameValue);
        lobby.SetData("name", SteamClient.Name + "'s game");
```

- **`SetPublic()`** lists the lobby where anyone's lobby search can find it. **`SetFriendsOnly()`** keeps it out of
  the list: your Steam friends can join it from their friends list, and you can invite people.
- **`SetJoinable(true)`** lets people in. You could set it to `false` once a round starts.
- **`SetData(key, value)`** writes a note on the lobby that **anyone can read without joining**. That's how the list
  shows a name, and how the search filters on `game = p2p-physics-test`. Lobby data is always strings.

Last, start Netcode as host on the Steam transport. Add:

```csharp
        CurrentLobby = lobby;
        UseTransport(steamTransport);
        Status(string.Empty);
        if (!NetworkManager.Singleton.StartHost())
        {
            Leave("Couldn't start hosting.");
            return;
        }
        LobbyChanged?.Invoke();
```

- **`StartHost()`** calls `SteamTransport.StartServer()`, which opens the relay door under your Steam ID. **You never
  give out an address.** Anyone in the lobby can see you're its owner, and that's enough to find you.
- **`Status(string.Empty)` comes before `StartHost`** on purpose. `StartHost` fires the "connected" event straight
  away, and the UI reacts by showing a "Press Tab" hint. Clearing the status afterwards would wipe that hint.
- **`Leave`** comes in step 6.7. It undoes everything if hosting fails.

### Step 6.5: finding lobbies

```csharp
    public async Task<Lobby[]> FindLobbies()
    {
        if (!SteamBootstrap.IsReady)
        {
            return Array.Empty<Lobby>();
        }

        Lobby[] found = await SteamMatchmaking.LobbyList
            .WithKeyValue(GameKey, GameValue)
            .WithSlotsAvailable(1)
            .RequestAsync();
        return found ?? Array.Empty<Lobby>();
    }
```

- **`SteamMatchmaking.LobbyList`** starts a search. Each `.With...` line narrows it:
  - **`WithKeyValue(GameKey, GameValue)`**: only lobbies whose note says `game = p2p-physics-test`. **Without this
    you'd see every Spacewar test lobby in the world.**
  - **`WithSlotsAvailable(1)`**: only lobbies with at least one free place.
- **`RequestAsync()`** sends the search and waits for the list.
- **`found ?? Array.Empty<Lobby>()`**: Steam gives back `null` when nothing matches. `??` means "or, if that's null,
  use this": an empty array, so the UI never has to check for null.
- **`async Task<Lobby[]>`**, not `async void`: this method hands back an answer, so the UI can `await` it.

By default, Steam's search only returns lobbies **near you** (roughly the same region). For friends far away, add
`.FilterDistanceWorldwide()` to the chain.

### Step 6.6: joining a lobby

All three ways in (the list, a pasted ID, a Steam invite) end up here:

```csharp
    public async void JoinSteam(SteamId lobbyId)
    {
        if (!SteamBootstrap.IsReady)
        {
            Status("Steam isn't running.");
            return;
        }

        Status("Joining the lobby...");
        Lobby? joined = await SteamMatchmaking.JoinLobbyAsync(lobbyId);
        if (joined == null)
        {
            Status("Couldn't join. The lobby may be full or gone.");
            return;
        }
    }
```

- **`SteamId`** is Facepunch's type for any Steam ID (a player's or a lobby's). It's a 64-bit number underneath, and
  a `ulong` converts to it automatically, which the paste-an-ID button relies on.
- **`JoinLobbyAsync`** makes you a member of the lobby, and gives back the lobby or nothing.

Now the important part: **connect to the lobby's owner**. Add after the `if (joined == null)` block:

```csharp
        Lobby lobby = joined.Value;
        CurrentLobby = lobby;
        steamTransport.targetSteamId = lobby.Owner.Id;
        UseTransport(steamTransport);
        Status("Connecting to " + lobby.Owner.Name + "...");
        if (!NetworkManager.Singleton.StartClient())
        {
            Leave("Couldn't start the client.");
            return;
        }
        LobbyChanged?.Invoke();
```

- **`lobby.Owner`** is the Steam user who owns the lobby: the host. `.Id` is their Steam ID; `.Name` is their name.
- **`steamTransport.targetSteamId = lobby.Owner.Id`** is **the** link between the two layers. It's the Steam version
  of typing the host's address into the join box. Section 11 follows it all the way through.
- **`StartClient()`** calls `SteamTransport.StartClient()`, which knocks on the owner's relay door. Like in guide
  section 3, this only *starts* connecting. The answer comes as an event.

### Step 6.7: leaving

```csharp
    public void Leave(string reason)
    {
        if (CurrentLobby.HasValue)
        {
            CurrentLobby.Value.Leave();
            CurrentLobby = null;
        }
        if (NetworkManager.Singleton.IsListening)
        {
            NetworkManager.Singleton.Shutdown();
        }
        LobbyChanged?.Invoke();
        Status(reason);
    }
```

- **`CurrentLobby.Value.Leave()`** removes you from the Steam lobby. If you're the owner, Steam hands ownership to
  another member automatically. Steam deletes a lobby when its last member leaves.
- **`IsListening`** is true while a Netcode session is running. **`Shutdown()`** ends it: as host, everyone gets
  disconnected; as a client, only you leave. Netcode then calls your `SteamTransport.Shutdown()`, which now closes the
  connections and leaves Steam running.
- **It always tidies up both layers.** Being in a lobby without a session, or the other way round, is the most common
  bug in lobby code.

`Shutdown` finishes at the end of the frame, not instantly, so don't host again in the same frame you leave. A human
clicking a button is never that fast.

### Step 6.8: reacting to Steam and Netcode events

**Lobby member changes.** Add these two methods:

```csharp
    private void OnEnable()
    {
        SteamMatchmaking.OnLobbyMemberJoined += OnMemberChanged;
        SteamMatchmaking.OnLobbyMemberLeave += OnMemberChanged;
        SteamMatchmaking.OnLobbyMemberDisconnected += OnMemberChanged;
    }

    private void OnDisable()
    {
        SteamMatchmaking.OnLobbyMemberJoined -= OnMemberChanged;
        SteamMatchmaking.OnLobbyMemberLeave -= OnMemberChanged;
        SteamMatchmaking.OnLobbyMemberDisconnected -= OnMemberChanged;
    }

    private void OnMemberChanged(Lobby lobby, Friend member)
    {
        if (CurrentLobby.HasValue && lobby.Id.Value == CurrentLobby.Value.Id.Value)
        {
            LobbyChanged?.Invoke();
        }
    }
```

- These Steam events are **static**: they belong to the `SteamMatchmaking` class, which lives for the whole game. If
  you forget the `-=`, Steam keeps calling a script that's gone. **Always pair `+=` with `-=` for static events.**
- **`Friend`** is Facepunch's type for "a Steam user", friend or not. `member.Name` is their name.
- The `if` checks the event is about **your** lobby. `.Value` is the plain 64-bit number inside each `SteamId`, which
  makes the comparison explicit.

**Steam invites.** When a friend invites you and you accept in the Steam overlay or friends list, Steam fires
`SteamFriends.OnGameLobbyJoinRequested`. Add the two lines to `OnEnable` and `OnDisable`:

```csharp
        SteamFriends.OnGameLobbyJoinRequested += OnJoinRequested;   // in OnEnable
        SteamFriends.OnGameLobbyJoinRequested -= OnJoinRequested;   // in OnDisable
```

and the handler:

```csharp
    private void OnJoinRequested(Lobby lobby, SteamId friendId)
    {
        if (CurrentLobby.HasValue)
        {
            Leave(string.Empty);
        }
        JoinSteam(lobby.Id);
    }
```

If you're already in a game, leave it first, then join the friend's lobby the normal way.

**Being disconnected.** When the host quits or your connection drops, Netcode tells you, as in guide section 3.4. The
lobby layer must follow, or you're left in a lobby with no game. Add:

```csharp
    private void Start()
    {
        NetworkManager.Singleton.OnClientDisconnectCallback += OnClientDisconnected;
    }

    private void OnDestroy()
    {
        if (NetworkManager.Singleton != null)
        {
            NetworkManager.Singleton.OnClientDisconnectCallback -= OnClientDisconnected;
        }
    }

    private void OnClientDisconnected(ulong clientId)
    {
        NetworkManager manager = NetworkManager.Singleton;
        if (manager.IsServer)
        {
            return;
        }
        string reason = string.IsNullOrEmpty(manager.DisconnectReason) ? "Disconnected." : manager.DisconnectReason;
        Leave(reason);
    }
```

This is guide section 3.4's handler, but it calls `Leave`, so the client also leaves the Steam lobby. The host ignores
it (`IsServer`), because on the host it fires for every client that leaves.

### The whole `SteamLobby.cs`

```csharp
using System;
using System.Threading.Tasks;
using Steamworks;
using Steamworks.Data;
using Unity.Netcode;
using Unity.Netcode.Transports.UTP;
using UnityEngine;

public class SteamLobby : MonoBehaviour
{
    private const string GameKey = "game";
    private const string GameValue = "p2p-physics-test";

    [SerializeField] private int maxPlayers = 4;
    [SerializeField] private SteamTransport steamTransport;
    [SerializeField] private UnityTransport unityTransport;

    public Lobby? CurrentLobby { get; private set; }

    public event Action LobbyChanged;
    public event Action<string> StatusChanged;

    private void OnEnable()
    {
        SteamMatchmaking.OnLobbyMemberJoined += OnMemberChanged;
        SteamMatchmaking.OnLobbyMemberLeave += OnMemberChanged;
        SteamMatchmaking.OnLobbyMemberDisconnected += OnMemberChanged;
        SteamFriends.OnGameLobbyJoinRequested += OnJoinRequested;
    }

    private void OnDisable()
    {
        SteamMatchmaking.OnLobbyMemberJoined -= OnMemberChanged;
        SteamMatchmaking.OnLobbyMemberLeave -= OnMemberChanged;
        SteamMatchmaking.OnLobbyMemberDisconnected -= OnMemberChanged;
        SteamFriends.OnGameLobbyJoinRequested -= OnJoinRequested;
    }

    private void Start()
    {
        NetworkManager.Singleton.OnClientDisconnectCallback += OnClientDisconnected;
    }

    private void OnDestroy()
    {
        if (NetworkManager.Singleton != null)
        {
            NetworkManager.Singleton.OnClientDisconnectCallback -= OnClientDisconnected;
        }
    }

    public void HostLocal()
    {
        UseTransport(unityTransport);
        if (!NetworkManager.Singleton.StartHost())
        {
            Status("Couldn't host. Is another window already hosting?");
        }
    }

    public void JoinLocal()
    {
        UseTransport(unityTransport);
        Status("Connecting to 127.0.0.1...");
        if (!NetworkManager.Singleton.StartClient())
        {
            Status("Couldn't start the client.");
        }
    }

    public async void HostSteam(bool friendsOnly)
    {
        if (!SteamBootstrap.IsReady)
        {
            Status("Steam isn't running.");
            return;
        }

        Status("Creating a lobby...");
        Lobby? created = await SteamMatchmaking.CreateLobbyAsync(maxPlayers);
        if (created == null)
        {
            Status("Couldn't create a lobby.");
            return;
        }

        Lobby lobby = created.Value;
        if (friendsOnly)
        {
            lobby.SetFriendsOnly();
        }
        else
        {
            lobby.SetPublic();
        }
        lobby.SetJoinable(true);
        lobby.SetData(GameKey, GameValue);
        lobby.SetData("name", SteamClient.Name + "'s game");

        CurrentLobby = lobby;
        UseTransport(steamTransport);
        Status(string.Empty);
        if (!NetworkManager.Singleton.StartHost())
        {
            Leave("Couldn't start hosting.");
            return;
        }
        LobbyChanged?.Invoke();
    }

    public async Task<Lobby[]> FindLobbies()
    {
        if (!SteamBootstrap.IsReady)
        {
            return Array.Empty<Lobby>();
        }

        Lobby[] found = await SteamMatchmaking.LobbyList
            .WithKeyValue(GameKey, GameValue)
            .WithSlotsAvailable(1)
            .RequestAsync();
        return found ?? Array.Empty<Lobby>();
    }

    public async void JoinSteam(SteamId lobbyId)
    {
        if (!SteamBootstrap.IsReady)
        {
            Status("Steam isn't running.");
            return;
        }

        Status("Joining the lobby...");
        Lobby? joined = await SteamMatchmaking.JoinLobbyAsync(lobbyId);
        if (joined == null)
        {
            Status("Couldn't join. The lobby may be full or gone.");
            return;
        }

        Lobby lobby = joined.Value;
        CurrentLobby = lobby;
        steamTransport.targetSteamId = lobby.Owner.Id;
        UseTransport(steamTransport);
        Status("Connecting to " + lobby.Owner.Name + "...");
        if (!NetworkManager.Singleton.StartClient())
        {
            Leave("Couldn't start the client.");
            return;
        }
        LobbyChanged?.Invoke();
    }

    public void Leave(string reason)
    {
        if (CurrentLobby.HasValue)
        {
            CurrentLobby.Value.Leave();
            CurrentLobby = null;
        }
        if (NetworkManager.Singleton.IsListening)
        {
            NetworkManager.Singleton.Shutdown();
        }
        LobbyChanged?.Invoke();
        Status(reason);
    }

    private void OnMemberChanged(Lobby lobby, Friend member)
    {
        if (CurrentLobby.HasValue && lobby.Id.Value == CurrentLobby.Value.Id.Value)
        {
            LobbyChanged?.Invoke();
        }
    }

    private void OnJoinRequested(Lobby lobby, SteamId friendId)
    {
        if (CurrentLobby.HasValue)
        {
            Leave(string.Empty);
        }
        JoinSteam(lobby.Id);
    }

    private void OnClientDisconnected(ulong clientId)
    {
        NetworkManager manager = NetworkManager.Singleton;
        if (manager.IsServer)
        {
            return;
        }
        string reason = string.IsNullOrEmpty(manager.DisconnectReason) ? "Disconnected." : manager.DisconnectReason;
        Leave(reason);
    }

    private void UseTransport(NetworkTransport transport)
    {
        NetworkManager.Singleton.NetworkConfig.NetworkTransport = transport;
    }

    private void Status(string message)
    {
        StatusChanged?.Invoke(message);
    }
}
```

**Hook it up:** select `NetworkManager` > **Add Component > SteamLobby**, then drag the NetworkManager object's own
**SteamTransport** component into **Steam Transport**, and its **UnityTransport** into **Unity Transport**. (Drag the
component's header from the Inspector, or drag the `NetworkManager` object itself: Unity picks the matching component.)

---

## 7. Script 4: `LobbyMenuUI`, the buttons

### The idea: the UI only asks and shows

`LobbyMenuUI` never talks to Steam or the NetworkManager about *doing* things. Each button calls a `SteamLobby` method.
The UI listens to `SteamLobby`'s events and Netcode's connect and disconnect events to decide what to show. It's
the same split as a Roblox LocalScript in PlayerGui calling a ModuleScript service.

Which panel is on:

| Situation | MainPanel | LobbyPanel | Cursor |
| --- | --- | --- | --- |
| not in a game | on | off | free |
| in a game | off | off, **Tab** toggles it (Steam games only) | your player script's choice; free while the panel is open |

### Step 7.1: the fields

Create `Assets/Scripts/UI/LobbyMenuUI.cs`:

```csharp
using Steamworks;
using Steamworks.Data;
using TMPro;
using Unity.Netcode;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.UI;

public class LobbyMenuUI : MonoBehaviour
{
    [SerializeField] private SteamLobby steamLobby;

    [Header("Main panel")]
    [SerializeField] private GameObject mainPanel;
    [SerializeField] private TMP_Text steamStatusText;
    [SerializeField] private Button hostPublicButton;
    [SerializeField] private Button hostFriendsButton;
    [SerializeField] private Button refreshButton;
    [SerializeField] private Transform lobbyListContent;
    [SerializeField] private GameObject emptyText;
    [SerializeField] private Button lobbyRowPrefab;
    [SerializeField] private TMP_InputField lobbyIdInput;
    [SerializeField] private Button joinByIdButton;
    [SerializeField] private Button localHostButton;
    [SerializeField] private Button localJoinButton;

    [Header("Lobby panel")]
    [SerializeField] private GameObject lobbyPanel;
    [SerializeField] private TMP_Text lobbyNameText;
    [SerializeField] private TMP_Text lobbyIdText;
    [SerializeField] private Button copyIdButton;
    [SerializeField] private TMP_Text playerListText;
    [SerializeField] private Button inviteButton;
    [SerializeField] private Button leaveButton;

    [Header("Always shown")]
    [SerializeField] private TMP_Text statusText;
}
```

- **`[Header("...")]`** only draws a heading in the Inspector, to group the slots.
- **`Button lobbyRowPrefab`**: a prefab can go in a slot of any component type it has. Typing it as `Button` means
  `Instantiate` hands you the new row's Button directly.
- **The field is called `steamLobby`**, not `lobby`, because `Lobby` is already the name of Steam's lobby type. Two
  names one letter apart are a reliable source of bugs.

### Step 7.2: wiring the buttons

```csharp
    private void Awake()
    {
        hostPublicButton.onClick.AddListener(() => steamLobby.HostSteam(false));
        hostFriendsButton.onClick.AddListener(() => steamLobby.HostSteam(true));
        localHostButton.onClick.AddListener(steamLobby.HostLocal);
        localJoinButton.onClick.AddListener(steamLobby.JoinLocal);
    }
```

- **`() => steamLobby.HostSteam(false)`** is a **lambda**, a small function with no name. It's Luau's
  `function() steamLobby:HostSteam(false) end`. You need one here because `onClick` calls methods with **no**
  inputs, and `HostSteam` needs one. The lambda takes nothing and passes the `false` itself.
- **`steamLobby.HostLocal`**, with no `()` or lambda, works because `HostLocal` already takes no inputs. You pass
  the method itself, as in guide section 3.1.
- **Why `Awake`, and no `RemoveListener`?** Guide section 3.1 paired `OnEnable` with `OnDisable` because that menu got
  switched off and on. `LobbyMenu`'s root is never switched off, only its panels are, so adding each listener once is
  enough. The buttons are destroyed along with this script, so nothing is left behind.

You'll add the other buttons' lines to `Awake` as you write their methods.

### Step 7.3: showing panels and status

```csharp
    private void ShowMenu()
    {
        mainPanel.SetActive(true);
        lobbyPanel.SetActive(false);
        Cursor.lockState = CursorLockMode.None;
        Cursor.visible = true;
    }

    private void ShowInGame()
    {
        mainPanel.SetActive(false);
        lobbyPanel.SetActive(false);
        ShowStatus(steamLobby.CurrentLobby.HasValue ? "Press Tab for the lobby and invites." : string.Empty);
    }

    private void ShowStatus(string message)
    {
        statusText.text = message;
    }
```

`ShowInGame` leaves the cursor alone: your player script locks it for mouse-look (guide step 4.5). The hint only shows
in Steam games, because local games have no lobby panel.

### Step 7.4: listening for events, and the starting state

```csharp
    private void Start()
    {
        steamLobby.LobbyChanged += RefreshLobbyPanel;
        steamLobby.StatusChanged += ShowStatus;
        NetworkManager.Singleton.OnClientConnectedCallback += OnClientConnected;
        NetworkManager.Singleton.OnClientDisconnectCallback += OnClientDisconnected;

        bool steamReady = SteamBootstrap.IsReady;
        steamStatusText.text = steamReady
            ? "Steam: signed in as " + SteamClient.Name
            : "Steam isn't running. Local test only.";
        hostPublicButton.interactable = steamReady;
        hostFriendsButton.interactable = steamReady;
        refreshButton.interactable = steamReady;
        joinByIdButton.interactable = steamReady;

        ShowMenu();
        ShowStatus(string.Empty);
    }

    private void OnDestroy()
    {
        if (steamLobby != null)
        {
            steamLobby.LobbyChanged -= RefreshLobbyPanel;
            steamLobby.StatusChanged -= ShowStatus;
        }
        if (NetworkManager.Singleton != null)
        {
            NetworkManager.Singleton.OnClientConnectedCallback -= OnClientConnected;
            NetworkManager.Singleton.OnClientDisconnectCallback -= OnClientDisconnected;
        }
    }

    private void OnClientConnected(ulong clientId)
    {
        if (clientId == NetworkManager.Singleton.LocalClientId)
        {
            ShowInGame();
        }
    }

    private void OnClientDisconnected(ulong clientId)
    {
        if (NetworkManager.Singleton.IsServer)
        {
            return;
        }
        ShowMenu();
    }
```

- **The connect and disconnect handlers** are guide section 3.3 and 3.4 again: "is it me?" on connect, and "not on
  the host" on disconnect. `OnClientConnectedCallback` fires for the host's own player too, as soon as `StartHost`
  succeeds, so hosting and joining both arrive at `ShowInGame` the same way.
- **`interactable = steamReady`** greys out the Steam buttons when Steam isn't running, so the local test row is the
  only thing left to click.
- **`RefreshLobbyPanel`** comes in step 7.7. It won't compile until then. That's fine; keep going.
- **The `!= null` checks in `OnDestroy`**: when you stop Play, either object may be destroyed first.

### Step 7.5: the lobby list

Add to `Awake`:

```csharp
        refreshButton.onClick.AddListener(OnRefreshClicked);
```

and the method:

```csharp
    private async void OnRefreshClicked()
    {
        refreshButton.interactable = false;
        ShowStatus("Looking for games...");
        Lobby[] found = await steamLobby.FindLobbies();
        if (this == null)
        {
            return;
        }
        refreshButton.interactable = true;
        ShowStatus(string.Empty);
    }
```

- **`await steamLobby.FindLobbies()`** is why `FindLobbies` returns a `Task`. The button handler waits for the
  answer while the game keeps running.
- **`if (this == null) return;`**: if you stop Play while the search is in flight, this object is destroyed before
  the answer comes back. In Unity, a destroyed object compares equal to `null`, so this check stops the method before
  it touches a dead UI. **Every `await` in a MonoBehaviour needs this check after it.**
- **Disabling the button** while waiting stops double clicks, as in guide section 3.3.

Now fill the list. Add after `ShowStatus(string.Empty);`:

```csharp
        foreach (Transform child in lobbyListContent)
        {
            Destroy(child.gameObject);
        }
        emptyText.SetActive(found.Length == 0);

        foreach (Lobby lobby in found)
        {
            Button row = Instantiate(lobbyRowPrefab, lobbyListContent);
            row.transform.Find("NameText").GetComponent<TMP_Text>().text = lobby.GetData("name");
            row.transform.Find("PlayersText").GetComponent<TMP_Text>().text = lobby.MemberCount + "/" + lobby.MaxMembers;
            SteamId lobbyId = lobby.Id;
            row.onClick.AddListener(() => steamLobby.JoinSteam(lobbyId));
        }
```

- **`foreach (Transform child in lobbyListContent)`** goes through every child of `Content`: the rows from the last
  refresh. `Destroy` removes them at the end of the frame, so destroying inside the loop is safe.
- **`Instantiate(lobbyRowPrefab, lobbyListContent)`** makes a copy of the row prefab **as a child of `Content`**.
  The Vertical Layout Group on `Content` stacks the rows; you don't position them. It's Roblox's
  `template:Clone()` with `Parent = list`, and a UIListLayout doing the layout.
- **`transform.Find("NameText")`** finds a child by name, which is why the prefab's names matter.
- **`lobby.GetData("name")`** reads the note the host wrote in step 6.4, **without joining** the lobby.
- **`SteamId lobbyId = lobby.Id;` and then the lambda**: the lambda "remembers" `lobbyId`. Each row gets its own
  copy, so each row joins its own lobby. (Roblox closures capture locals in the same way.)
- **`EmptyText`** sits outside `Content` in the prefab, so the clean-up loop never deletes it.

### Step 7.6: joining by ID

The lobby list only shows public lobbies. A pasted ID is the easiest way to test, and the way into a friends-only
lobby without an invite. Add to `Awake`:

```csharp
        joinByIdButton.onClick.AddListener(OnJoinByIdClicked);
```

and:

```csharp
    private void OnJoinByIdClicked()
    {
        if (ulong.TryParse(lobbyIdInput.text.Trim(), out ulong id))
        {
            steamLobby.JoinSteam(id);
        }
        else
        {
            ShowStatus("That isn't a lobby ID. It's a long number.");
        }
    }
```

- **`ulong.TryParse(text, out ulong id)`** tries to read the text as a 64-bit whole number. It returns `true` and puts
  the number in `id` if that works, or `false` if not. It's Luau's `tonumber`, but safe for numbers this big (a
  Steam ID has about 17 digits; Luau's numbers would round it).
- **`.Trim()`** removes spaces from either end, which pasting often adds.
- **`JoinSteam(id)`** takes a `SteamId`, and the `ulong` converts to one automatically.

### Step 7.7: the lobby panel

```csharp
    private void RefreshLobbyPanel()
    {
        if (!steamLobby.CurrentLobby.HasValue)
        {
            lobbyPanel.SetActive(false);
            return;
        }

        Lobby lobby = steamLobby.CurrentLobby.Value;
        lobbyNameText.text = lobby.GetData("name");
        lobbyIdText.text = "ID: " + lobby.Id;

        string names = string.Empty;
        foreach (Friend member in lobby.Members)
        {
            bool isHost = member.Id.Value == lobby.Owner.Id.Value;
            names += member.Name + (isHost ? " (host)" : string.Empty) + "\n";
        }
        playerListText.text = names;
    }
```

- It runs whenever `SteamLobby` fires `LobbyChanged`: when you join, leave, or someone else joins or leaves.
- **`lobby.Members`** is everyone **in the Steam lobby**. That's not quite the same as everyone **connected to the
  game**: for a second or two after joining, a player is in the lobby but still connecting. For a "who's here" list
  that's fine; for gameplay ("everyone's ready"), use Netcode's own connected list.
- **`"\n"`** is a line break.

The three lobby panel buttons. Add to `Awake`:

```csharp
        copyIdButton.onClick.AddListener(OnCopyIdClicked);
        inviteButton.onClick.AddListener(OnInviteClicked);
        leaveButton.onClick.AddListener(OnLeaveClicked);
```

and:

```csharp
    private void OnCopyIdClicked()
    {
        if (steamLobby.CurrentLobby.HasValue)
        {
            GUIUtility.systemCopyBuffer = steamLobby.CurrentLobby.Value.Id.ToString();
            ShowStatus("Lobby ID copied. Send it to a friend.");
        }
    }

    private void OnInviteClicked()
    {
        if (steamLobby.CurrentLobby.HasValue)
        {
            SteamFriends.OpenGameInviteOverlay(steamLobby.CurrentLobby.Value.Id);
        }
    }

    private void OnLeaveClicked()
    {
        steamLobby.Leave(string.Empty);
        ShowMenu();
    }
```

- **`GUIUtility.systemCopyBuffer`** is the system clipboard. Setting it is "Ctrl+C" from code.
- **`OpenGameInviteOverlay`** opens Steam's own "invite friends" window over the game. **The Steam overlay doesn't
  work inside the Unity editor**, so this button does nothing there. It works in a build (section 9).
- **`OnLeaveClicked`** shows the menu itself, because the host doesn't get the client-side disconnect event.

### Step 7.8: Tab opens the lobby panel in game

```csharp
    private void Update()
    {
        if (Keyboard.current == null || !Keyboard.current.tabKey.wasPressedThisFrame)
        {
            return;
        }
        if (mainPanel.activeSelf || !steamLobby.CurrentLobby.HasValue)
        {
            return;
        }

        bool show = !lobbyPanel.activeSelf;
        lobbyPanel.SetActive(show);
        Cursor.lockState = show ? CursorLockMode.None : CursorLockMode.Locked;
        Cursor.visible = show;
        ShowStatus(string.Empty);
        RefreshLobbyPanel();
    }
```

- **`Keyboard.current.tabKey.wasPressedThisFrame`** is the Input System's "Tab went down this frame", like
  `UserInputService.InputBegan` checking for `Enum.KeyCode.Tab`. `Keyboard.current` is `null` when no keyboard is
  plugged in, hence the first check.
- **It only works in a Steam game** (main menu hidden, lobby present).
- **Unlocking the cursor** while the panel is open lets you click Copy, Invite and Leave; closing it locks the cursor
  again for mouse-look.

### The whole `LobbyMenuUI.cs`

```csharp
using Steamworks;
using Steamworks.Data;
using TMPro;
using Unity.Netcode;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.UI;

public class LobbyMenuUI : MonoBehaviour
{
    [SerializeField] private SteamLobby steamLobby;

    [Header("Main panel")]
    [SerializeField] private GameObject mainPanel;
    [SerializeField] private TMP_Text steamStatusText;
    [SerializeField] private Button hostPublicButton;
    [SerializeField] private Button hostFriendsButton;
    [SerializeField] private Button refreshButton;
    [SerializeField] private Transform lobbyListContent;
    [SerializeField] private GameObject emptyText;
    [SerializeField] private Button lobbyRowPrefab;
    [SerializeField] private TMP_InputField lobbyIdInput;
    [SerializeField] private Button joinByIdButton;
    [SerializeField] private Button localHostButton;
    [SerializeField] private Button localJoinButton;

    [Header("Lobby panel")]
    [SerializeField] private GameObject lobbyPanel;
    [SerializeField] private TMP_Text lobbyNameText;
    [SerializeField] private TMP_Text lobbyIdText;
    [SerializeField] private Button copyIdButton;
    [SerializeField] private TMP_Text playerListText;
    [SerializeField] private Button inviteButton;
    [SerializeField] private Button leaveButton;

    [Header("Always shown")]
    [SerializeField] private TMP_Text statusText;

    private void Awake()
    {
        hostPublicButton.onClick.AddListener(() => steamLobby.HostSteam(false));
        hostFriendsButton.onClick.AddListener(() => steamLobby.HostSteam(true));
        refreshButton.onClick.AddListener(OnRefreshClicked);
        joinByIdButton.onClick.AddListener(OnJoinByIdClicked);
        localHostButton.onClick.AddListener(steamLobby.HostLocal);
        localJoinButton.onClick.AddListener(steamLobby.JoinLocal);
        copyIdButton.onClick.AddListener(OnCopyIdClicked);
        inviteButton.onClick.AddListener(OnInviteClicked);
        leaveButton.onClick.AddListener(OnLeaveClicked);
    }

    private void Start()
    {
        steamLobby.LobbyChanged += RefreshLobbyPanel;
        steamLobby.StatusChanged += ShowStatus;
        NetworkManager.Singleton.OnClientConnectedCallback += OnClientConnected;
        NetworkManager.Singleton.OnClientDisconnectCallback += OnClientDisconnected;

        bool steamReady = SteamBootstrap.IsReady;
        steamStatusText.text = steamReady
            ? "Steam: signed in as " + SteamClient.Name
            : "Steam isn't running. Local test only.";
        hostPublicButton.interactable = steamReady;
        hostFriendsButton.interactable = steamReady;
        refreshButton.interactable = steamReady;
        joinByIdButton.interactable = steamReady;

        ShowMenu();
        ShowStatus(string.Empty);
    }

    private void OnDestroy()
    {
        if (steamLobby != null)
        {
            steamLobby.LobbyChanged -= RefreshLobbyPanel;
            steamLobby.StatusChanged -= ShowStatus;
        }
        if (NetworkManager.Singleton != null)
        {
            NetworkManager.Singleton.OnClientConnectedCallback -= OnClientConnected;
            NetworkManager.Singleton.OnClientDisconnectCallback -= OnClientDisconnected;
        }
    }

    private void Update()
    {
        if (Keyboard.current == null || !Keyboard.current.tabKey.wasPressedThisFrame)
        {
            return;
        }
        if (mainPanel.activeSelf || !steamLobby.CurrentLobby.HasValue)
        {
            return;
        }

        bool show = !lobbyPanel.activeSelf;
        lobbyPanel.SetActive(show);
        Cursor.lockState = show ? CursorLockMode.None : CursorLockMode.Locked;
        Cursor.visible = show;
        ShowStatus(string.Empty);
        RefreshLobbyPanel();
    }

    private void ShowMenu()
    {
        mainPanel.SetActive(true);
        lobbyPanel.SetActive(false);
        Cursor.lockState = CursorLockMode.None;
        Cursor.visible = true;
    }

    private void ShowInGame()
    {
        mainPanel.SetActive(false);
        lobbyPanel.SetActive(false);
        ShowStatus(steamLobby.CurrentLobby.HasValue ? "Press Tab for the lobby and invites." : string.Empty);
    }

    private void ShowStatus(string message)
    {
        statusText.text = message;
    }

    private void OnClientConnected(ulong clientId)
    {
        if (clientId == NetworkManager.Singleton.LocalClientId)
        {
            ShowInGame();
        }
    }

    private void OnClientDisconnected(ulong clientId)
    {
        if (NetworkManager.Singleton.IsServer)
        {
            return;
        }
        ShowMenu();
    }

    private async void OnRefreshClicked()
    {
        refreshButton.interactable = false;
        ShowStatus("Looking for games...");
        Lobby[] found = await steamLobby.FindLobbies();
        if (this == null)
        {
            return;
        }
        refreshButton.interactable = true;
        ShowStatus(string.Empty);

        foreach (Transform child in lobbyListContent)
        {
            Destroy(child.gameObject);
        }
        emptyText.SetActive(found.Length == 0);

        foreach (Lobby lobby in found)
        {
            Button row = Instantiate(lobbyRowPrefab, lobbyListContent);
            row.transform.Find("NameText").GetComponent<TMP_Text>().text = lobby.GetData("name");
            row.transform.Find("PlayersText").GetComponent<TMP_Text>().text = lobby.MemberCount + "/" + lobby.MaxMembers;
            SteamId lobbyId = lobby.Id;
            row.onClick.AddListener(() => steamLobby.JoinSteam(lobbyId));
        }
    }

    private void OnJoinByIdClicked()
    {
        if (ulong.TryParse(lobbyIdInput.text.Trim(), out ulong id))
        {
            steamLobby.JoinSteam(id);
        }
        else
        {
            ShowStatus("That isn't a lobby ID. It's a long number.");
        }
    }

    private void RefreshLobbyPanel()
    {
        if (!steamLobby.CurrentLobby.HasValue)
        {
            lobbyPanel.SetActive(false);
            return;
        }

        Lobby lobby = steamLobby.CurrentLobby.Value;
        lobbyNameText.text = lobby.GetData("name");
        lobbyIdText.text = "ID: " + lobby.Id;

        string names = string.Empty;
        foreach (Friend member in lobby.Members)
        {
            bool isHost = member.Id.Value == lobby.Owner.Id.Value;
            names += member.Name + (isHost ? " (host)" : string.Empty) + "\n";
        }
        playerListText.text = names;
    }

    private void OnCopyIdClicked()
    {
        if (steamLobby.CurrentLobby.HasValue)
        {
            GUIUtility.systemCopyBuffer = steamLobby.CurrentLobby.Value.Id.ToString();
            ShowStatus("Lobby ID copied. Send it to a friend.");
        }
    }

    private void OnInviteClicked()
    {
        if (steamLobby.CurrentLobby.HasValue)
        {
            SteamFriends.OpenGameInviteOverlay(steamLobby.CurrentLobby.Value.Id);
        }
    }

    private void OnLeaveClicked()
    {
        steamLobby.Leave(string.Empty);
        ShowMenu();
    }
}
```

---

## 8. Hooking up `LobbyMenuUI`

Select `LobbyMenu` (the root of the prefab you dragged into the scene) > **Add Component > LobbyMenuUI**, then fill
every slot. Inactive objects can still be dragged.

| Slot | Drag in |
| --- | --- |
| Steam Lobby | the `NetworkManager` object (it picks the SteamLobby component) |
| Main Panel | `LobbyMenu/MainPanel` |
| Steam Status Text | `MainPanel/SteamStatusText` |
| Host Public Button | `MainPanel/HostRow/HostPublicButton` |
| Host Friends Button | `MainPanel/HostRow/HostFriendsButton` |
| Refresh Button | `MainPanel/BrowseRow/RefreshButton` |
| Lobby List Content | `MainPanel/LobbyList/Viewport/Content` |
| Empty Text | `MainPanel/LobbyList/EmptyText` |
| Lobby Row Prefab | **`Assets/Prefabs/UI/LobbyRow`**, from the Project window, not the scene |
| Lobby Id Input | `MainPanel/JoinIdRow/LobbyIdInput` |
| Join By Id Button | `MainPanel/JoinIdRow/JoinByIdButton` |
| Local Host Button | `MainPanel/LocalRow/LocalHostButton` |
| Local Join Button | `MainPanel/LocalRow/LocalJoinButton` |
| Lobby Panel | `LobbyMenu/LobbyPanel` |
| Lobby Name Text | `LobbyPanel/LobbyNameText` |
| Lobby Id Text | `LobbyPanel/LobbyIdRow/LobbyIdText` |
| Copy Id Button | `LobbyPanel/LobbyIdRow/CopyIdButton` |
| Player List Text | `LobbyPanel/PlayerListText` |
| Invite Button | `LobbyPanel/InviteButton` |
| Leave Button | `LobbyPanel/LeaveButton` |
| Status Text | `LobbyMenu/StatusText` |

An empty slot gives a `NullReferenceException` the moment its line runs. The Console error names the script and line,
which tells you which slot you missed.

**The NetworkManager object should now have**, top to bottom: NetworkManager, UnityTransport, SteamBootstrap,
SteamTransport, SteamLobby. The NetworkManager's **Transport** slot still says **UnityTransport**.

**Save the scene (Ctrl+S)** before pressing Play. Multiplayer Play Mode's extra players load the scene from disk.

---

## 9. Testing

### 9.1 Local test, one PC (every day)

1. Tick **Player 2** in **Window > Multiplayer > Multiplayer Play Mode**, and press Play.
2. Main window: **Local test > Host**. The menu disappears and you spawn.
3. Player 2: **Local test > Join**. It shows "Connecting to 127.0.0.1...", then the menu disappears.

The Steam buttons may be clickable in both windows, since both found Steam running, but they're the **same Steam
account**, so don't use them here.

### 9.2 Steam test, two PCs

**Once only, set up the laptop:**
1. **Make a second Steam account** at store.steampowered.com (free). New accounts are "limited" until they've spent
   money, and a limited account **can't send** friend requests but **can accept** them. So from your **main** account,
   add the new one as a friend, and accept on the new one. You need to be friends for invites and friends-only lobbies.
2. Install Steam on the laptop and sign in with the **second** account. You don't need to own or install Spacewar.

**Each time you want to test:**
1. **Make a build** on your desktop: **File > Build Profiles**, choose **Windows**, make sure SampleScene is in the
   scene list, and click **Build**. Pick an empty folder, for example `Builds/Test`.
2. **Copy the whole build folder** to the laptop: USB stick, a shared network folder, or a zip over Discord. Copy the
   folder, not just the `.exe`: the game needs the `_Data` folder and the DLLs beside it.
3. **Desktop:** press Play in the editor (or run the build). Click **Host public**.
4. **Laptop:** run the `.exe`. The status line should say "Steam: signed in as" the second account. Click
   **Refresh**. Your desktop's game appears in the list; click it.
5. You're in. Press **Tab** on either machine to see both names in the lobby panel.

**Also try:**
- **Join by ID:** host, press Tab, click **Copy**, paste the ID into a message to yourself, and on the laptop paste it
  into **Paste a lobby ID > Join**.
- **Invites:** host **friends only** from a **build**, since the overlay doesn't open in the editor. Press Tab >
  **Invite friends**, and invite the second account. Accept on the laptop. (Shift+Tab is Steam's own overlay key in a
  build.)
- **The host leaving:** click **Leave** on the host. The laptop should go back to the menu with "Disconnected."
- **Under lag:** the NetworkManager's Network Simulator (guide section 9) still works, because it sits above the
  transport.

---

## 10. When something goes wrong

| What you see | Likely cause |
| --- | --- |
| "Steam isn't running. Local test only." | Steam is closed or signed out. Start it, sign in, press Play again. |
| `DllNotFoundException: steam_api64` | the editor hasn't been restarted since installing the package |
| `SteamTransport` won't add as a component | the class name and file name differ, or the file has compile errors (Console) |
| Errors about `unsafe` or `fixed` | step 5.5 isn't finished in one of the `OnMessage` methods |
| Refresh finds nothing | the lobby is friends-only (not listed); the two copies have different `GameValue`s (rebuild after changing it); the PCs are far apart (add `.FilterDistanceWorldwide()`); or Steam needed a few more seconds, so refresh again |
| Joins the lobby, then "Disconnected." after a few seconds | the host's game isn't running a Steam session: check the host clicked a **Steam** button, not Local |
| Second Refresh or Host fails after leaving a game | the transport still has `SteamClient.Shutdown()` in `Shutdown` (step 5.4) |
| A `NullReferenceException` in `LobbyMenuUI` | an empty Inspector slot (section 8) |
| Invite button does nothing | you're in the editor: the Steam overlay only works in builds |

---

## 11. How the lobby connects to your NetworkManager

This is the full chain from "I see a game in the list" to "I'm in the host's game", next to the local version you
already know.

### There is no IP address

With Unity Transport, the client needs the host's **IP address and port**: `SetConnectionData("127.0.0.1", 7777)`.
With Steam there is no address at all. **The host's Steam ID is the address**, and Valve's relay network finds the
machine behind it. That's why nothing in this guide ever reads or shares an IP: the lobby gives you the owner's Steam
ID, and the transport dials it.

### The chain, step by step

```
HOST                                                  CLIENT
────                                                  ──────
1. CreateLobbyAsync         → Steam lobby made,
                              host is its Owner
2. SetData("game", ...)     → the lobby carries
   SetData("name", ...)       public notes
3. NetworkTransport =
   SteamTransport
4. StartHost()
   → SteamTransport.StartServer()
   → CreateRelaySocket      → a relay "door" opens
                              under the host's
                              Steam ID
                                                      5. LobbyList.WithKeyValue("game", ...)
                                                         → finds the lobby, reads "name"
                                                      6. JoinLobbyAsync(lobby.Id)
                                                         → now a member; can read lobby.Owner
                                                      7. steamTransport.targetSteamId
                                                            = lobby.Owner.Id       ← THE LINK
                                                      8. NetworkTransport = SteamTransport
                                                      9. StartClient()
                                                         → SteamTransport.StartClient()
                                                         → ConnectRelay(targetSteamId)
                    ◄────────── Valve's relay network ──────────►
10. ISocketManager.OnConnecting → Accept()
11. ISocketManager.OnConnected                        IConnectionManager.OnConnected
    → InvokeOnTransportEvent(Connect, id)            → InvokeOnTransportEvent(Connect, 0)
12. Netcode's usual handshake runs on top: approval, scene sync, the Player prefab spawns
13. OnClientConnectedCallback on both machines → LobbyMenuUI.ShowInGame()
```

### Side by side with what you had

| Step | Local (Unity Transport) | Steam |
| --- | --- | --- |
| How the client learns where the host is | you type `127.0.0.1` (or a `192.168.x.x` LAN address) | it joins the lobby and reads `lobby.Owner.Id` |
| Where that goes | `unityTransport.SetConnectionData(address, port)` | `steamTransport.targetSteamId = ownerId` |
| Host starts listening | opens UDP port 7777 on the PC | `CreateRelaySocket`: a door on Valve's relay under the host's Steam ID |
| Client connects | sends packets to the IP and port | `ConnectRelay(steamId)` through the relay |
| Works across the internet? | only with port forwarding, and the host's IP is visible | yes, through almost any router, and IPs stay hidden |
| What Netcode sees | a transport saying "connected, client N" | exactly the same |

### The one-sentence version

**The Steam lobby tells everyone who the host is; the Steam transport turns "who" into a connection; and from there,
the NetworkManager runs your game exactly as it does on `127.0.0.1`.** Your gameplay scripts (movement, pushes, boxes,
carrying) never change between local and Steam.

### Why not store the host's IP in the lobby instead?

You *could* put the host's IP in lobby data (`SetData("ip", ...)`) and keep Unity Transport. That's how some older
tutorials do it. It's worse in every way: the host has to set up port forwarding, every player can see the host's
home IP address, and most home connections refuse incoming connections anyway. The relay solves all three, which is
why the Steam transport exists.

---

## 12. Exercises

1. **A "Quick Play" button:** search with `.WithSlotsAvailable(1)`, join the first lobby found, or host a new public
   one if there are none.
2. **Show who's connecting:** in `RefreshLobbyPanel`, mark members who are in the lobby but not yet in the game. Hint:
   the host can compare `lobby.Members` with `NetworkManager.Singleton.ConnectedClientsIds`.
3. **A version check:** put your build number in lobby data (`SetData("version", "1")`) and filter on it too, so an
   old build never joins a new one.
4. **Lock the lobby when a round starts:** call `SetJoinable(false)` on the host, and `true` again afterwards.
5. **Launching from an invite while the game is closed:** Steam starts the game with `+connect_lobby <id>` on its
   command line. Read it with `System.Environment.GetCommandLineArgs()` in `SteamLobby.Start`, and call `JoinSteam`.
6. **Real ping:** `GetCurrentRtt` returns 0 for now, so Netcode's stats show no ping on Steam. Facepunch's
   `Connection.DetailedStatus()` returns a text report that includes a `Ping:` line; read the number out of it.
