#pragma once
#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    LED_IDLE = 0,
    LED_DISCOVERING,
    LED_OBSERVING,
    LED_ENCODING,
    LED_TRANSMITTING,
    LED_ERROR
} led_mode_t;

void led_init(int pin);
void led_set_mode(led_mode_t mode);
void led_write(bool on); /* only optical_tx during TRANSMITTING */
led_mode_t led_mode(void);

#ifdef __cplusplus
}
#endif
