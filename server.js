import { MongoClient, ObjectId } from "mongodb";
import { Server } from "socket.io";
import "dotenv/config";

const smallBoardEmpty = ["", "", "", "", "", "", "", "", ""];
const bigBoardEmpty = [
    ["", "", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", ""],
];

const uri = process.env.MONGO_DB;

const client = new MongoClient(uri);

await client.connect();
console.log("Connected to mongoDB database...");

const db = client.db("UltimateTicTacToe");

const games = db.collection("games");
const accounts = db.collection("accounts");

async function joinGame(gameID, playerID) {
    const result = await games.find({ _id: ObjectId(gameID) }).toArray();
    if (!result) return false;
    const game = result[0];

    if (
        (game["pX"] && game["pX"].toHexString() === playerID) ||
        (game["pO"] && game["pO"].toHexString() === playerID)
    ) {
        return true;
    } else if (game["pO"] === null) {
        games.updateOne(
            { _id: ObjectId(gameID) },
            { $set: { pO: ObjectId(playerID) } }
        );
        return true;
    } else return false;
}

async function gameInfo(gameID) {
    const result = await games.find({ _id: ObjectId(gameID) }).toArray();
    if (!result) return null;
    const game = result[0];

    return game;
}

async function gameList(playerID) {
    const result = await games
        .find(
            { $or: [{ pX: ObjectId(playerID) }, { pO: ObjectId(playerID) }] },
            {
                _id: 1,
                pX: 1,
                pO: 1,
                status: 1,
                winner: 1,
            }
        )
        .sort({ "creation-date": -1 })
        .limit(15)
        .toArray();

    return result;
}

async function createAccount(name) {
    const result = await accounts.insertOne({
        name: name,
        wins: 0,
        losses: 0,
        ties: 0,
    });

    return result["insertedId"].toHexString();
}

async function createGame(playerId) {
    const today = new Date();

    const result = await games.insertOne({
        pX: ObjectId(playerId),
        pO: null,
        status: false,
        winner: null,
        bigBoard: bigBoardEmpty,
        smallBoard: smallBoardEmpty,
        "creation-date": new Date(
            `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`
        ),
        playing: "pX",
        last: -1,
    });

    return result["insertedId"].toHexString();
}

async function playerInfo(playerID) {
    if (!playerID) return null;
    const result = await accounts
        .find({ _id: ObjectId(playerID) }, { name: 1 })
        .toArray();
    if (!result) return null;
    return result[0];
}

function changeStat(stat, playerID) {
    if (stat === "wins")
        accounts.updateOne({ _id: ObjectId(playerID) }, { $inc: { wins: 1 } });
    else if (stat === "ties")
        accounts.updateOne({ _id: ObjectId(playerID) }, { $inc: { ties: 1 } });
    else if (stat === "losses")
        accounts.updateOne(
            { _id: ObjectId(playerID) },
            { $inc: { losses: 1 } }
        );
}

async function play(gameID, playerID, big, small) {
    const game = await gameInfo(gameID);
    const switchSymbol = { X: "O", O: "X" };

    if (
        game[game["playing"]].toHexString() === playerID &&
        !game["status"] &&
        game["smallBoard"][small] === "" &&
        game["bigBoard"][small][big] === "" &&
        (game["last"] === -1 || game["last"] === small)
    ) {
        // Play will be registered - ONLY HERE
        const symbol = game["playing"].slice(-1);
        game["bigBoard"][small][big] = symbol;
        game["playing"] = "p" + switchSymbol[symbol];
        console.log(isGameOver(game["bigBoard"][small]));
        console.log(boardFull(game["bigBoard"][small]));
        if (isGameOver(game["bigBoard"][small])) {
            game["smallBoard"][small] = symbol;
            if (isGameOver(game["smallBoard"])) {
                game["status"] = true;
                game["winner"] = playerID;
                changeStat("wins", playerID);
                changeStat("losses", game[game["playing"]].toHexString());
            }
        } else if (boardFull(game["bigBoard"][small])) {
            game["smallBoard"][small] = "-";
            console.log("tied");
        }
        if (boardFull(game["smallBoard"])) {
            game["status"] = true;
            changeStat("ties", playerID);
            changeStat("ties", game[game["playing"]].toHexString());
        }

        game["last"] = game["smallBoard"][big] === "" ? big : -1;
        const result = await games.updateOne(
            { _id: ObjectId(gameID) },
            {
                $set: {
                    ...game,
                    _id: ObjectId(gameID),
                    pX: ObjectId(game["pX"]),
                    pO: ObjectId(game["pO"]),
                },
            }
        );
        console.log(result);
    }

    return true;
}

function boardFull(board) {
    for (let i = 0; i < board.length; i++) {
        if (board[i] === "") return false;
    }

    return true;
}

function isGameOver(board) {
    if (
        board[0] !== "" &&
        board[0] !== "-" &&
        ((board[0] === board[1] && board[1] === board[2]) ||
            (board[0] === board[3] && board[3] === board[6]) ||
            (board[0] === board[4] && board[4] === board[8]))
    ) {
        return board[0];
    } else if (
        board[4] !== "" &&
        board[4] !== "-" &&
        ((board[3] === board[4] && board[4] === board[5]) ||
            (board[1] === board[4] && board[4] === board[7]) ||
            (board[2] === board[4] && board[4] === board[6]))
    ) {
        return board[4];
    } else if (
        board[8] !== "" &&
        board[8] !== "-" &&
        ((board[6] === board[7] && board[7] === board[8]) ||
            (board[2] === board[5] && board[5] === board[8]))
    ) {
        return board[8];
    }
    return false;
}

/*
###################################
Socket.io only from here and beyond
###################################
*/

const io = new Server(process.env.PORT, {
    cors: {
        origin: "*",
    },
});

io.on("connection", (socket) => {
    console.log(`Received connection with id ${socket.id}`);

    socket.on("create-account", async (name, callback) => {
        console.log(`Creating account with name ${name} for ${socket.id}`);
        callback(await createAccount(name));
    });

    socket.on("game-list", async (playerID, callback) => {
        console.log(`Sending game list to player ${playerID}`);
        callback(await gameList(playerID));
    });

    socket.on("create-game", async (playerID, callback) => {
        console.log(`Creating game for player ${playerID}`);
        callback(await createGame(playerID));
    });

    socket.on("join", async (gameID, playerID, callback) => {
        const response = await joinGame(gameID, playerID);

        if (response) {
            socket.join(gameID);
            console.log(
                `Joined connection with id ${socket.id} to room ${gameID}`
            );
        }

        callback(response);
    });

    socket.on("game-info", async (gameID, callback) => {
        console.log(`Received game info (${gameID}) request`);
        if (socket.rooms.has(gameID)) {
            const game = await gameInfo(gameID);
            console.log(`Sending game info (${gameID})`);
            callback(game);
        } else callback(null);
    });

    socket.on("player-info", async (playerID, callback) => {
        console.log(`Sending player info about ${playerID}`);
        callback(await playerInfo(playerID));
    });

    socket.on("play", async (gameID, playerID, small, big) => {
        const result = await play(gameID, playerID, big, small);

        const game = await gameInfo(gameID);
        console.log(`Registered play in ${gameID} from ${playerID}`);
        io.to(gameID).emit("played", game);
    });
});
