class EMASmoother:
    def __init__(self, alpha=0.5):
        self.alpha = alpha
        self.last_val = None

    def smooth(self, current_val):
        """
        current_val: tuple of floats (e.g. (x, y, w, h) or (cx, cy))
        """
        if self.last_val is None:
            self.last_val = current_val
            return current_val
            
        smoothed = tuple(
            self.alpha * curr + (1 - self.alpha) * last
            for curr, last in zip(current_val, self.last_val)
        )
        self.last_val = smoothed
        return smoothed
