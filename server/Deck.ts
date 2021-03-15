import { Card, CardColor, CardType } from "./Card";

const colors: CardColor[] = [0, 1, 2, 3];

export default class Deck {
  cards: Card[] = [];

  constructor() {}

  generateDeck() {
    this.cards = [];

    colors.forEach((color) => {
      // create 0
      this.cards.push(new Card(0, color, CardType.None));

      // create 2 of each number 1 to 9
      for (let number = 1; number <= 9; number++) {
        this.cards.push(new Card(number, color, CardType.None));
        this.cards.push(new Card(number, color, CardType.None));
      }

      // create 2 of each plus 2, reverse, skip
      for (let type: CardType = CardType.Plus2; type <= CardType.Skip; type++) {
        this.cards.push(new Card(0, color, type));
        this.cards.push(new Card(0, color, type));
      }
    });

    // create 4 of wildcard, plus4
    for (let type: CardType = CardType.Wildcard; type <= CardType.Plus4; type++) {
      this.cards.push(new Card(0, CardColor.None, type));
      this.cards.push(new Card(0, CardColor.None, type));
    }
  }

  shuffleDeck() {
    let i = this.cards.length;
    let temp: Card;
    let randIndex: number = 0;

    // While there remain cards to shuffle...
    while (0 !== i) {
      // Pick a remaining card...
      randIndex = Math.floor(Math.random() * i);
      i -= 1;

      // And swap it with the current card.
      temp = this.cards[i];
      this.cards[i] = this.cards[randIndex];
      this.cards[randIndex] = temp;
    }
  }

  pickCard(i: number) {
    return this.cards.splice(i, 1);
  }
}
