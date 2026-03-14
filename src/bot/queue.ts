export class MessageQueue {
  private queues: Map<number, Promise<void>> = new Map();
  private timeoutMs: number;

  constructor(timeoutMs: number = 120000) {
    this.timeoutMs = timeoutMs;
  }

  enqueue<T>(chatId: number, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(chatId) ?? Promise.resolve();

    const current = new Promise<T>((resolve, reject) => {
      previous.then(() => {
        const timeout = new Promise<never>((_, timeoutReject) =>
          setTimeout(
            () => timeoutReject(new Error('LLM timeout: antwoord duurde te lang')),
            this.timeoutMs
          )
        );
        Promise.race([task(), timeout]).then(resolve, reject);
      });
    });

    // Store a void version that never rejects, so the queue continues after errors
    this.queues.set(
      chatId,
      current.then(
        () => {},
        () => {}
      )
    );

    return current;
  }
}
