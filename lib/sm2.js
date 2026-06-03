export function sm2Calc(quality, card) {
  var EF = card.easinessFactor || 2.5;
  var interval = card.interval || 0;
  var reps = card.repetitions || 0;
  var today = new Date().toISOString().slice(0, 10);

  if (quality < 3) {
    reps = 0;
    interval = 0;
  } else {
    if (reps === 0) {
      interval = 1;
    } else if (reps === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * EF);
    }
    reps += 1;
  }

  var q = quality;
  EF = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  if (EF < 1.3) EF = 1.3;

  var nextReview = new Date();
  nextReview.setDate(nextReview.getDate() + interval);
  var nextReviewStr = nextReview.toISOString().slice(0, 10);

  return {
    easinessFactor: Math.round(EF * 100) / 100,
    interval: interval,
    repetitions: reps,
    nextReview: nextReviewStr,
    lastReview: today,
    lastQuality: q
  };
}
