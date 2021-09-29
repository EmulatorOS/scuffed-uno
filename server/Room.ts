import { v4 as uuid } from "uuid";
import { Card, CardColor, CardType } from "./Card";
import Deck from "./Deck";
import Player from "./Player";
import { decrementStat, incrementStat } from "./Stats";

export interface Settings {
  stacking: boolean;
  forcePlay: boolean;
  bluffing: boolean;
  drawToPlay: boolean;
  public: boolean;
  maxPlayers: number;
}

interface RoomInterface {
  id: string;
  started: boolean;
  host: Player;
  players: Player[];
  deck: Deck;
  pile: Card[];
  turn: Player;
  directionReversed: boolean;
  stack: number;
  winner: Player | null;
  isRoomEmpty: boolean;
  inactivityTimer: number;
  inactivityTimerInterval: NodeJS.Timeout | null;
  wildcard: Card | null;
  settings: Settings;

  addPlayer(player: Player): void;
  removePlayer(player: Player): void;
  startGame(): void;
  giveCard(player: Player): Card;
  playCard(player: Player, cardIndex: number): void;
  getNextPlayer(): Player;
  refillDeckFromPile(): void;
}

export class Room implements RoomInterface {
  id = "";
  started: boolean = false;
  host: Player;
  players: Player[] = [];
  deck: Deck = new Deck();
  pile: Card[] = [];
  turn: Player;
  directionReversed: boolean = false;
  stack: number = 0;
  winner: Player | null = null;
  isRoomEmpty: boolean = false;
  inactivityTimer: number = 0;
  inactivityTimerInterval: NodeJS.Timeout | null = null;
  wildcard: Card | null = null;
  settings: Settings;

  constructor(host: Player, settings: Settings, id: string = "") {
    this.id = id || uuid().substr(0, 7);
    this.host = host;
    this.turn = host;
    this.settings = settings;
    this.addPlayer(host);

    incrementStat("lobbiesCreated", 1);
    incrementStat("lobbiesOnline", 1);
  }

  addPlayer(player: Player) {
    player.roomId = this.id;
    player.inRoom = true;

    this.players.push(player);
    this.broadcastState();
  }

  removePlayer(player: Player, replace: boolean = true) {
    const players = this.players.filter((p) => !p.bot && p.id !== player.id);
    if (players.length === 0) {
      this.isRoomEmpty = true;
      decrementStat("lobbiesOnline", 1);
    } else if (this.host.id === player.id) {
      this.host = players[Math.floor(Math.random() * players.length)];
    }

    if (replace && !this.isRoomEmpty) {
      // create replacement bot
      const bot = this.createBot(player);
      this.addBot(bot, player);
    } else {
      this.players = this.players.filter((p) => p.id !== player.id);
    }

    this.broadcastState();

    player.roomId = "";
    player.inRoom = false;
    player.cards = [];

    // if only 1 player is left and remove is not replaced then kick last player as game cannot be played
    if (players.length === 1 && !replace && this.started) {
      this.removePlayer(this.host, false);
      this.host.socket?.emit("kicked");
      console.log("kicked");
    }
  }

  startGame() {
    this.deck.generateDeck();
    this.deck.shuffleDeck();

    // place starting card on pile
    this.pile.push(this.deck.pickCard());
    if (this.topCard().type === CardType.Plus4 || this.topCard().type === CardType.Wildcard) {
      this.topCard().color = Math.floor(Math.random() * 4);
    }

    // give players cards
    this.players.forEach((p) => {
      for (let i = 0; i < 7; i++) {
        this.giveCard(p);
      }

      p.sortCards();
    });

    // pick player to start
    const randIndex = Math.floor(Math.random() * this.players.length);
    this.turn = this.players[randIndex];
    this.turn.findPlayableCards(this.topCard());
    this.turn.canDraw = true;
    this.turn.canPlay = true;

    if (this.turn.bot) {
      this.turn.botPlay(this);
    }

    this.started = true;

    this.broadcastState();

    // start inactivity timer
    this.inactivityTimerInterval = setInterval(async () => {
      this.inactivityTimer++;

      if (this.inactivityTimer === 300) {
        this.players.forEach((p) => (!p.bot ? this.removePlayer(p, false) : null));
      }
    }, 1000);
  }

  // giveCard takes the first card from the deck array and pushes it onto player's cards
  // then updates the player's playable cards if it is their turn
  // returns the given Card
  giveCard(player: Player): Card {
    if (this.deck.cards.length === 0) {
      this.refillDeckFromPile();
    }

    const card = this.deck.pickCard();
    player.cards.push(card);

    if (this.turn.id === player.id && this.started) {
      player.findPlayableCards(this.topCard());
    }

    return card;
  }

  // drawCards draws cards from the deck and gives them to player
  async drawCards(player: Player, amount: number = -1) {
    // exit early if player:
    // - is drawing,
    // - player is not able to draw and they aren't being +2ed or +4ed
    if (player.drawing || (!player.canDraw && amount === -1)) return;

    if (amount === -1) player.canDraw = false;
    player.drawing = true;

    const drawn: Card[] = [];
    let i = 0;

    // loops while:
    // - if amount is -1: player hasn't drawn a playable card
    // - else: draws until i === amount
    while (
      (amount === -1 && drawn.findIndex((c) => c.playable) === -1) ||
      (amount !== -1 && amount !== i && !this.isRoomEmpty)
    ) {
      drawn.push(this.giveCard(player));
      player.sortCards();

      // find index of last drawn card in sorted list
      player.lastDrawnCard = player.cards.findIndex((c) => c.id === drawn[drawn.length - 1].id);

      this.broadcastState();

      // delay drawing
      await sleep(amount !== -1 ? 400 : 800);

      i++;

      // handle drawing with custom rules
      if (amount === -1 && !this.settings.drawToPlay) {
        if (drawn.findIndex((c) => c.playable) === -1) {
          await sleep(400);
          player.drawing = false;
          this.nextTurn();
          return;
        }

        break;
      }
    }

    // make last draw card only playable card
    player.cards.forEach((c) => (c.playable = false));
    player.cards[player.lastDrawnCard] ? (player.cards[player.lastDrawnCard].playable = true) : null;

    if (amount === -1 && !this.settings.forcePlay) {
      player.socket?.emit("can-keep-card");
    }

    player.drawing = false;
    this.broadcastState();
  }

  // playCard performs game logic based on what card a player wishes to play
  async playCard(player: Player, cardIndex: number) {
    if (
      !player.canPlay ||
      !player.cards[cardIndex] ||
      this.turn.id !== player.id ||
      !player.cards[cardIndex].playable
    )
      return;

    incrementStat("cardsPlayed", 1);

    // reset wildcard
    this.wildcard = null;

    // get card and remove from players cards
    const card = player.cards[cardIndex];
    player.cards.splice(cardIndex, 1);

    // put card on pile
    this.pile.push(card);

    const nextPlayer = this.getNextPlayer();
    let draw = 0;

    switch (card.type) {
      case CardType.Plus2:
        if (nextPlayer.cards.findIndex((c) => c.type === CardType.Plus2) !== -1) {
          nextPlayer.mustStack = true;
          this.stack += 2;
        } else {
          draw = this.stack + 2;
          this.clearStack();
        }
        break;
      case CardType.Plus4:
        incrementStat("plus4sDealt", 1);

        if (nextPlayer.cards.findIndex((c) => c.type === CardType.Plus4) !== -1) {
          nextPlayer.mustStack = true;
          this.stack += 4;
        } else {
          draw = this.stack + 4;
          this.clearStack();
        }
        break;
      case CardType.Reverse:
        this.directionReversed = !this.directionReversed;
        break;
    }

    // punish player for not calling uno
    // TODO make other players need to call out player to be punished
    if (player.cards.length === 1 && !player.hasCalledUno) {
      await this.drawCards(player, 2);
    }
    player.hasCalledUno = false;

    // go to next turn
    if (
      ((card.type === CardType.Plus2 || card.type === CardType.Plus4) && !nextPlayer.mustStack) ||
      card.type === CardType.Skip
    ) {
      this.nextTurn(true, draw);
    } else {
      this.nextTurn();
    }
  }

  clearStack() {
    this.stack = 0;
    this.players.forEach((p) => (p.mustStack = false));
  }

  async nextTurn(skip: boolean = false, draw: number = 0) {
    // reset inactivity timer
    this.inactivityTimer = 0;

    this.turn.clearPlayableCards();
    this.turn.canDraw = false;
    this.turn.canPlay = false;

    if (skip || draw !== 0) {
      this.turn = this.getNextPlayer();
      this.turn.canDraw = false;
      this.turn.canPlay = false;

      this.broadcastState();
      await sleep(1500);

      if (draw !== 0) {
        await this.drawCards(this.turn, draw);
      }
    }

    // gets next player - works because if player should be skipped then turn has already been incremented above
    // so here next player acts as skip otherwise, just regular increment of next player
    this.turn = this.getNextPlayer();
    if (!this.turn) return;

    this.turn.canDraw = true;
    this.turn.canPlay = true;
    this.turn.findPlayableCards(this.topCard());

    this.checkForWinner();
    this.broadcastState();

    if (this.winner) return incrementStat("gamesPlayed", 1);

    if (this.turn.bot) {
      this.turn.botPlay(this);
    }
  }

  getNextPlayer(offset: number = 0): Player {
    let i = this.players.findIndex((p) => p.id === this.turn.id);

    if (this.directionReversed) {
      i -= 1 + offset;
      if (i < 0) i = this.players.length + i;
    } else {
      i += 1 + offset;
      if (i > this.players.length - 1) i -= this.players.length;
    }

    return this.players[i];
  }

  checkForWinner() {
    this.players.forEach((p) => (p.cards.length === 0 ? (this.winner = p) : null));
  }

  refillDeckFromPile() {
    const cards = this.pile.splice(0, this.pile.length - 1);
    this.deck.cards.push(...cards);

    // clean wildcards
    this.deck.cards.map((c) => {
      if (c.type === CardType.Wildcard || c.type === CardType.Plus4) c.color = CardColor.None;
    });

    this.deck.shuffleDeck();
  }

  // gets the player who is in the seat offset number of positions clockwise from the given player
  getPlayerPosFromOffset(player: Player, offset: number) {
    const playerIndex = this.players.findIndex((p) => p.id === player.id);
    let newIndex = playerIndex + offset;
    newIndex > this.players.length - 1 ? (newIndex -= this.players.length) : null;

    return this.players[newIndex];
  }

  broadcastState() {
    this.players.forEach((player) => {
      if (player.bot) return;

      let right;
      let top;
      let left;
      switch (this.players.length) {
        case 4:
          left = this.getPlayerPosFromOffset(player, 3);
        case 3:
          top = this.getPlayerPosFromOffset(player, 2);
        case 2:
          right = this.getPlayerPosFromOffset(player, 1);
          break;
      }

      const winner = this.winner ? { username: this.winner.username, id: this.winner.id } : undefined;

      const state = {
        id: this.id,
        isHost: this.host.id === player.id,
        host: this.host.id,
        turn: this.turn.id,
        pile: this.pile,
        started: this.started,
        directionReversed: this.directionReversed,
        stack: this.stack,
        playerCount: this.players.length,
        maxPlayers: this.settings.maxPlayers,
        wildcard: this.wildcard,
        you: {
          ...player,
          count: player.cards.length,
          socket: undefined,
          calledUno: player.hasCalledUno,
          skip: !player.canPlay && this.turn.id === player.id,
        },
        right: right
          ? {
              username: right.username,
              count: right.cards.length,
              id: right.id,
              isBot: right.bot,
              calledUno: right.hasCalledUno,
              skip: !right.canPlay && this.turn.id === right.id,
            }
          : undefined,
        top: top
          ? {
              username: top.username,
              count: top.cards.length,
              id: top.id,
              isBot: top.bot,
              calledUno: top.hasCalledUno,
              skip: !top.canPlay && this.turn.id === top.id,
            }
          : undefined,
        left: left
          ? {
              username: left.username,
              count: left.cards.length,
              id: left.id,
              isBot: left.bot,
              calledUno: left.hasCalledUno,
              skip: !left.canPlay && this.turn.id === left.id,
            }
          : undefined,
        winner,
      };

      player.socket?.emit("state", state);
    });
  }

  createBot(player?: Player): Player {
    const bot = new Player(null, true);
    bot.inRoom = true;
    bot.roomId = this.id;

    const botNames = [
      "John",
      "James",
      "Alice",
      "Sean",
      "Joe",
      "Fred",
      "Bob",
      "Pat",
      "Jack",
      "Adam",
      "Nathaniel",
      "Freddie",
      "Baka",
      "Sussy",
    ];
    bot.username = `Bot ${botNames[Math.floor(Math.random() * botNames.length)]}`;

    if (player) bot.cards = [...player.cards];

    incrementStat("botsUsed", 1);

    return bot;
  }

  addBot(bot: Player, player?: Player) {
    if (player) {
      const index = this.players.findIndex((p) => p.id === player.id);
      this.players[index] = bot;

      if (this.turn.id === player.id) {
        this.turn = bot;
        this.turn.botPlay(this);
      }
    } else {
      if (this.players.length === 4) return;

      this.players.push(bot);
    }
  }

  topCard(): Card {
    return this.pile[this.pile.length - 1];
  }
}

function sleep(time: number) {
  return new Promise((resolve) => setTimeout(resolve, time));
}
